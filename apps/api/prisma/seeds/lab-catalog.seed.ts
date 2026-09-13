import { PrismaClient } from '@prisma/client';
import { EXCLUDED_FROM_LAB_MASTER, SEED_LAB_TESTS } from './lab-catalog-data';

/**
 * Seeds the laboratory test master: one LabTest per LAB-* service (except
 * ECG/Nadi/Prakrati, which are billable but not lab tests — see the data
 * file's header), with parameters and reference ranges where a reference
 * report was available to transcribe them from.
 *
 * Idempotent and non-destructive: re-running never touches a parameter's
 * ranges once seeded (a Pathologist may have corrected them since), matching
 * the same "never revert an approved value" rule the pricing seed follows.
 */
export async function seedLabCatalog(prisma: PrismaClient): Promise<void> {
  let testsCreated = 0;
  let testsSkipped = 0;
  let parametersCreated = 0;
  let demoGradeCount = 0;

  for (const seed of SEED_LAB_TESTS) {
    const service = await prisma.service.findUnique({ where: { code: seed.serviceCode } });
    if (!service) {
      throw new Error(`Lab catalog seed references unknown service ${seed.serviceCode}`);
    }

    const existing = await prisma.labTest.findUnique({ where: { serviceId: service.id } });
    if (existing) {
      testsSkipped++;
      continue;
    }

    const labTest = await prisma.labTest.create({
      data: {
        serviceId: service.id,
        code: seed.serviceCode.replace(/^LAB-/, 'LT-'),
        name: service.name,
        discipline: seed.discipline,
        specimenType: seed.specimenType,
        containerType: seed.containerType ?? null,
        turnaroundHours: seed.turnaroundHours ?? 24,
      },
    });
    testsCreated++;
    if (seed.demoGrade) demoGradeCount++;

    const parameters = seed.parameters ?? [{ name: service.name }];
    for (let i = 0; i < parameters.length; i++) {
      const param = parameters[i];
      const createdParam = await prisma.labTestParameter.create({
        data: {
          labTestId: labTest.id,
          name: param.name,
          groupLabel: param.groupLabel ?? null,
          unit: param.unit ?? null,
          resultType: param.resultType ?? 'NUMERIC',
          selectOptions: param.selectOptions ?? [],
          method: param.method ?? null,
          isCalculated: param.isCalculated ?? false,
          formula: param.formula ?? null,
          interpretation: param.interpretation ?? null,
          sortOrder: i,
        },
      });
      parametersCreated++;

      for (const range of param.ranges ?? []) {
        await prisma.labReferenceRange.create({
          data: {
            parameterId: createdParam.id,
            displayText: range.displayText,
            numericLow: range.numericLow ?? null,
            numericHigh: range.numericHigh ?? null,
            sex: range.sex ?? 'ANY',
          },
        });
      }
    }
  }

  console.log(
    `  ✓ Seeded ${testsCreated} lab tests with ${parametersCreated} parameters ` +
      `(${testsSkipped} already existed, preserved as-is)`,
  );
  console.log(
    `  ⓘ ${demoGradeCount} tests have a single generic parameter with no reference range ` +
      `(no source report to transcribe from) — confirm with a Pathologist before clinical use. ` +
      `${EXCLUDED_FROM_LAB_MASTER.join(', ')} remain billable Services but are not lab tests.`,
  );
}
