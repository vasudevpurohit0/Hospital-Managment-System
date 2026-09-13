/**
 * Laboratory test master, seeded from the institute pathology rate board (for
 * which tests exist and their specimen category) and, for the seven panels
 * where the pricing folder's report photographs show real reportable
 * parameters, the parameters and reference ranges transcribed from those
 * reports:
 *
 *   CBC/Haemogram         WhatsApp Image 2026-08-24 at 22.11.03.jpeg
 *   LFT + RFT/KFT         WhatsApp Image 2026-08-24 at 22.11.03 (1).jpeg
 *   Lipid Profile         WhatsApp Image 2026-08-24 at 22.11.02 (1).jpeg
 *   Urine R/M             WhatsApp Image 2026-08-24 at 22.11.02 (2).jpeg
 *   HbA1c + Serology(RA)  WhatsApp Image 2026-08-24 at 22.11.01 (2).jpeg
 *   Haematology/Biochem/Serology screen (BT/CT, RBS, HIV, HBsAg)
 *                         WhatsApp Image 2026-08-24 at 22.11.02.jpeg
 *
 * Every other seeded test gets exactly ONE parameter, named after the test
 * itself, with no reference range — Feature 6 explicitly warns against
 * inventing medical reference ranges, so a range is seeded only where a real
 * report was available to transcribe. These are flagged `demoGrade: true` and
 * must be confirmed by a Pathologist before clinical use (see plan §23 risk:
 * "Lab reference ranges transcribed from photographs").
 *
 * ECG, Nadi Pariksha and Prakrati Pariksha remain billable Services but are
 * NOT lab tests — they have no specimen, panel, or LIS-style result to model.
 */

export type Discipline =
  | 'HAEMATOLOGY'
  | 'BIOCHEMISTRY'
  | 'SEROLOGY'
  | 'CLINICAL_PATHOLOGY'
  | 'MICROBIOLOGY';

export interface SeedRange {
  displayText: string;
  numericLow?: number;
  numericHigh?: number;
  sex?: 'MALE' | 'FEMALE' | 'ANY';
}

export interface SeedParameter {
  name: string;
  groupLabel?: string;
  unit?: string;
  resultType?: 'NUMERIC' | 'TEXT' | 'SELECT';
  selectOptions?: string[];
  method?: string;
  isCalculated?: boolean;
  formula?: string;
  interpretation?: string;
  ranges?: SeedRange[];
}

export interface SeedLabTest {
  serviceCode: string;
  discipline: Discipline;
  specimenType: string;
  containerType?: string;
  turnaroundHours?: number;
  /** Real parameters transcribed from a reference report. Omitted → one generic parameter. */
  parameters?: SeedParameter[];
  /** True unless a reference report backs every range on this test. */
  demoGrade?: boolean;
}

/** Services that exist in the catalogue but are not laboratory tests. */
export const EXCLUDED_FROM_LAB_MASTER = ['LAB-ECG', 'LAB-NADI', 'LAB-PRAKRATI'];

const CBC_PARAMETERS: SeedParameter[] = [
  { name: 'Haemoglobin', unit: 'gm%', ranges: [{ displayText: '13-18', numericLow: 13, numericHigh: 18 }] },
  { name: 'Total W.B.C. Count', groupLabel: 'W.B.C COUNT', unit: '/cmm', ranges: [{ displayText: '4000-11000', numericLow: 4000, numericHigh: 11000 }] },
  { name: 'Neutrophils', groupLabel: 'W.B.C COUNT', unit: '%', ranges: [{ displayText: '40-75', numericLow: 40, numericHigh: 75 }] },
  { name: 'Lymphocytes', groupLabel: 'W.B.C COUNT', unit: '%', ranges: [{ displayText: '20-45', numericLow: 20, numericHigh: 45 }] },
  { name: 'Monocytes', groupLabel: 'W.B.C COUNT', unit: '%', ranges: [{ displayText: '0-10', numericLow: 0, numericHigh: 10 }] },
  { name: 'Eosinophil', groupLabel: 'W.B.C COUNT', unit: '%', ranges: [{ displayText: '1-6', numericLow: 1, numericHigh: 6 }] },
  { name: 'Basophils', groupLabel: 'W.B.C COUNT', unit: '%', ranges: [{ displayText: '0-2', numericLow: 0, numericHigh: 2 }] },
  { name: 'R.B.C. Count', groupLabel: 'RBC INDICES', unit: 'mil./cmm', ranges: [{ displayText: '4.7-6.1', numericLow: 4.7, numericHigh: 6.1 }] },
  { name: 'Haematocrit (HCT)', groupLabel: 'RBC INDICES', unit: '%', ranges: [{ displayText: '36-47', numericLow: 36, numericHigh: 47 }] },
  { name: 'MCV', groupLabel: 'RBC INDICES', unit: 'fL', ranges: [{ displayText: '75-96', numericLow: 75, numericHigh: 96 }] },
  { name: 'MCH', groupLabel: 'RBC INDICES', unit: 'pg', ranges: [{ displayText: '27-32', numericLow: 27, numericHigh: 32 }] },
  { name: 'MCHC', groupLabel: 'RBC INDICES', unit: 'gm/dl', ranges: [{ displayText: '30-36', numericLow: 30, numericHigh: 36 }] },
  { name: 'Platelet Count', groupLabel: 'PLATELETS INDICES', unit: 'Lakh/cumm', ranges: [{ displayText: '1.5-4.5', numericLow: 1.5, numericHigh: 4.5 }] },
];

const LFT_PARAMETERS: SeedParameter[] = [
  { name: 'Serum Bilirubin - Total', groupLabel: 'SERUM BILIRUBIN', unit: 'Mg/dl', ranges: [{ displayText: '0.0-1.2', numericLow: 0, numericHigh: 1.2 }] },
  { name: 'Serum Bilirubin - Direct', groupLabel: 'SERUM BILIRUBIN', unit: 'Mg/dl', ranges: [{ displayText: '0.0-0.3', numericLow: 0, numericHigh: 0.3 }] },
  { name: 'Serum Bilirubin - Indirect', groupLabel: 'SERUM BILIRUBIN', unit: 'Mg/dl', isCalculated: true, formula: 'Total − Direct', ranges: [{ displayText: '0.0-0.9', numericLow: 0, numericHigh: 0.9 }] },
  { name: 'SGOT', unit: 'U/l', ranges: [{ displayText: '05-31', numericLow: 5, numericHigh: 31 }] },
  { name: 'SGPT', unit: 'U/l', ranges: [{ displayText: '05-45', numericLow: 5, numericHigh: 45 }] },
  { name: 'Alkaline Phosphatase', unit: 'U/L', ranges: [{ displayText: '45-129', numericLow: 45, numericHigh: 129 }] },
];

const KFT_PARAMETERS: SeedParameter[] = [
  { name: 'Urea', unit: 'mg/dl', ranges: [{ displayText: '18-40', numericLow: 18, numericHigh: 40 }] },
  { name: 'Creatinine', unit: 'mg/dl', ranges: [{ displayText: '0.6-1.3', numericLow: 0.6, numericHigh: 1.3 }] },
  { name: 'Urea/Creatinine Ratio', unit: 'mg/dl', isCalculated: true, formula: 'Urea ÷ Creatinine', ranges: [{ displayText: '7-25', numericLow: 7, numericHigh: 25 }] },
  { name: 'Uric Acid', unit: 'mg/dl', ranges: [{ displayText: '3.7-7.2', numericLow: 3.7, numericHigh: 7.2 }] },
];

const LIPID_PARAMETERS: SeedParameter[] = [
  { name: 'Total Cholesterol', unit: 'mg/dL', ranges: [{ displayText: '125-200', numericLow: 125, numericHigh: 200 }] },
  { name: 'Triglycerides', unit: 'mg/dL', ranges: [{ displayText: '40-150', numericLow: 40, numericHigh: 150 }] },
  { name: 'HDL Cholesterol', unit: 'mg/dL', ranges: [{ displayText: '35.3-79.5', numericLow: 35.3, numericHigh: 79.5 }] },
  { name: 'LDL Cholesterol', unit: 'mg/dl', isCalculated: true, formula: 'Total − HDL − VLDL', ranges: [{ displayText: '70-100', numericLow: 70, numericHigh: 100 }] },
  { name: 'VLDL Cholesterol', unit: 'mg/dl', isCalculated: true, formula: 'Triglycerides ÷ 5', ranges: [{ displayText: '05-40', numericLow: 5, numericHigh: 40 }] },
  { name: 'TC / HDL Cholesterol Ratio', isCalculated: true, formula: 'Total Cholesterol ÷ HDL', ranges: [{ displayText: '3.0-5.0', numericLow: 3.0, numericHigh: 5.0 }] },
  { name: 'LDL / HDL Ratio', isCalculated: true, formula: 'LDL ÷ HDL', ranges: [{ displayText: '1.5-3.5', numericLow: 1.5, numericHigh: 3.5 }] },
];

const URINE_RM_PARAMETERS: SeedParameter[] = [
  { name: 'Quantity', groupLabel: 'PHYSICAL EXAMINATION', unit: 'ml', resultType: 'TEXT' },
  { name: 'Colour', groupLabel: 'PHYSICAL EXAMINATION', resultType: 'TEXT', ranges: [{ displayText: 'Pale Yellow' }] },
  { name: 'Appearance', groupLabel: 'PHYSICAL EXAMINATION', resultType: 'TEXT', ranges: [{ displayText: 'Clear' }] },
  { name: 'Specific Gravity', groupLabel: 'PHYSICAL EXAMINATION', resultType: 'NUMERIC' },
  { name: 'Reaction (pH)', groupLabel: 'CHEMICAL EXAMINATION', resultType: 'TEXT', ranges: [{ displayText: 'Acidic' }] },
  { name: 'Albumin', groupLabel: 'CHEMICAL EXAMINATION', resultType: 'SELECT', selectOptions: ['Absent', 'Trace', '+', '++', '+++'], ranges: [{ displayText: 'Absent' }] },
  { name: 'Sugar', groupLabel: 'CHEMICAL EXAMINATION', resultType: 'SELECT', selectOptions: ['Absent', 'Trace', '+', '++', '+++'], ranges: [{ displayText: 'Absent' }] },
  { name: 'Ketone Bodies', groupLabel: 'CHEMICAL EXAMINATION', resultType: 'SELECT', selectOptions: ['Absent', 'Present'], ranges: [{ displayText: 'Absent' }] },
  { name: 'Bile Salt', groupLabel: 'CHEMICAL EXAMINATION', resultType: 'SELECT', selectOptions: ['Absent', 'Present'], ranges: [{ displayText: 'Absent' }] },
  { name: 'Bile Pigment', groupLabel: 'CHEMICAL EXAMINATION', resultType: 'SELECT', selectOptions: ['Absent', 'Present'], ranges: [{ displayText: 'Absent' }] },
  { name: 'PUS (WBC) Cells', groupLabel: 'MICROSCOPIC EXAMINATION', unit: '/hpf', ranges: [{ displayText: '1-2', numericLow: 1, numericHigh: 2 }] },
  { name: 'Epithelial Cells', groupLabel: 'MICROSCOPIC EXAMINATION', unit: '/hpf', ranges: [{ displayText: '2-4', numericLow: 2, numericHigh: 4 }] },
  { name: 'R.B.C.', groupLabel: 'MICROSCOPIC EXAMINATION', unit: '/hpf', ranges: [{ displayText: '0-1', numericLow: 0, numericHigh: 1 }] },
  { name: 'Casts', groupLabel: 'MICROSCOPIC EXAMINATION', resultType: 'SELECT', selectOptions: ['Absent', 'Present'], ranges: [{ displayText: 'Absent' }] },
  { name: 'Crystals', groupLabel: 'MICROSCOPIC EXAMINATION', resultType: 'SELECT', selectOptions: ['Absent', 'Present'], ranges: [{ displayText: 'Absent' }] },
  { name: 'Bacteria', groupLabel: 'MICROSCOPIC EXAMINATION', resultType: 'SELECT', selectOptions: ['Absent', 'Present'], ranges: [{ displayText: 'Absent' }] },
];

const HBA1C_PARAMETERS: SeedParameter[] = [
  {
    name: 'HbA1c',
    unit: '%',
    interpretation:
      'As per ADA guidelines: below 5.7% Normal, 5.7-6.4% Prediabetic, ≥6.5% Diabetic.',
    ranges: [{ displayText: 'Below 5.7% : Normal', numericHigh: 5.7 }],
  },
  { name: 'Average Blood Glucose (ABG)', unit: 'mg/dl', isCalculated: true, formula: 'Derived from HbA1c (ADAG equation)' },
];

const RA_FACTOR_PARAMETER: SeedParameter[] = [
  {
    name: 'RA Factor',
    unit: 'IU/ml',
    ranges: [{ displayText: '0-20', numericLow: 0, numericHigh: 20 }],
    interpretation:
      'Rheumatoid factor is an antibody directed against the Fc portion of the IgG molecule.',
  },
];

const BT_CT_PARAMETERS: SeedParameter[] = [
  { name: 'Bleeding Time', groupLabel: 'Bleeding Time & Clotting Time', unit: 'minute', ranges: [{ displayText: '1-5', numericLow: 1, numericHigh: 5 }] },
  { name: 'Clotting Time', groupLabel: 'Bleeding Time & Clotting Time', unit: 'minute', ranges: [{ displayText: '4-9', numericLow: 4, numericHigh: 9 }] },
];

export const SEED_LAB_TESTS: SeedLabTest[] = [
  // ── Panels with real transcribed parameters ────────────────────────────
  { serviceCode: 'LAB-CBC', discipline: 'HAEMATOLOGY', specimenType: 'Blood (EDTA)', containerType: 'Lavender-top vacutainer', parameters: CBC_PARAMETERS },
  { serviceCode: 'LAB-LFT', discipline: 'BIOCHEMISTRY', specimenType: 'Blood (Serum)', containerType: 'Red-top vacutainer', parameters: LFT_PARAMETERS },
  { serviceCode: 'LAB-KFT', discipline: 'BIOCHEMISTRY', specimenType: 'Blood (Serum)', containerType: 'Red-top vacutainer', parameters: KFT_PARAMETERS },
  { serviceCode: 'LAB-LIPID', discipline: 'BIOCHEMISTRY', specimenType: 'Blood (Serum, fasting)', containerType: 'Red-top vacutainer', parameters: LIPID_PARAMETERS },
  { serviceCode: 'LAB-URINERM', discipline: 'CLINICAL_PATHOLOGY', specimenType: 'Urine', containerType: 'Sterile urine container', parameters: URINE_RM_PARAMETERS },
  { serviceCode: 'LAB-HBA1C', discipline: 'BIOCHEMISTRY', specimenType: 'Blood (EDTA)', containerType: 'Lavender-top vacutainer', parameters: HBA1C_PARAMETERS },
  { serviceCode: 'LAB-RAQUANT', discipline: 'SEROLOGY', specimenType: 'Blood (Serum)', containerType: 'Red-top vacutainer', parameters: RA_FACTOR_PARAMETER },
  { serviceCode: 'LAB-CTBT', discipline: 'HAEMATOLOGY', specimenType: 'Blood', parameters: BT_CT_PARAMETERS },
  { serviceCode: 'LAB-RBS', discipline: 'BIOCHEMISTRY', specimenType: 'Blood (Fluoride)', containerType: 'Grey-top vacutainer', parameters: [{ name: 'Blood Sugar - Random', unit: 'Mg/dl', ranges: [{ displayText: '70-140', numericLow: 70, numericHigh: 140 }] }] },
  { serviceCode: 'LAB-HIV', discipline: 'SEROLOGY', specimenType: 'Blood (Serum)', parameters: [{ name: 'HIV I & II', resultType: 'SELECT', selectOptions: ['Non-Reactive', 'Reactive'], method: 'Rapid Card Method', ranges: [{ displayText: 'Non-Reactive' }] }] },
  { serviceCode: 'LAB-HBSAG', discipline: 'SEROLOGY', specimenType: 'Blood (Serum)', parameters: [{ name: 'HBsAg', resultType: 'SELECT', selectOptions: ['Non-Reactive', 'Reactive'], method: 'Rapid Card Method', ranges: [{ displayText: 'Non-Reactive' }] }] },

  // ── Remaining tests: one generic parameter, no invented range ──────────
  ...([
    ['LAB-HB', 'HAEMATOLOGY', 'Blood', 'Hb%', 'gm%'],
    ['LAB-TLCDLC', 'HAEMATOLOGY', 'Blood', 'TLC & DLC', undefined],
    ['LAB-ESR', 'HAEMATOLOGY', 'Blood', 'ESR', 'mm/hr'],
    ['LAB-RETIC', 'HAEMATOLOGY', 'Blood', 'Reticulocyte Count', '%'],
    ['LAB-PSMP', 'HAEMATOLOGY', 'Blood', 'Peripheral Smear for M.P.', undefined],
    ['LAB-BLOODGRP', 'HAEMATOLOGY', 'Blood', 'Blood Group & Rh', undefined],
    ['LAB-FBS', 'BIOCHEMISTRY', 'Blood (Fluoride, fasting)', 'Fasting Blood Sugar', 'mg/dl'],
    ['LAB-PPBS', 'BIOCHEMISTRY', 'Blood (Fluoride, post-prandial)', 'PP Blood Sugar', 'mg/dl'],
    ['LAB-GTT', 'BIOCHEMISTRY', 'Blood (Fluoride, serial)', 'Glucose Tolerance Test', 'mg/dl'],
    ['LAB-UREA', 'BIOCHEMISTRY', 'Blood (Serum)', 'Urea', 'mg/dl'],
    ['LAB-CREAT', 'BIOCHEMISTRY', 'Blood (Serum)', 'Creatinine', 'mg/dl'],
    ['LAB-CALCIUM', 'BIOCHEMISTRY', 'Blood (Serum)', 'Calcium', 'mg/dl'],
    ['LAB-CHOL', 'BIOCHEMISTRY', 'Blood (Serum)', 'Cholesterol', 'mg/dl'],
    ['LAB-HDL', 'BIOCHEMISTRY', 'Blood (Serum)', 'HDL Cholesterol', 'mg/dl'],
    ['LAB-TRIG', 'BIOCHEMISTRY', 'Blood (Serum)', 'Triglyceride', 'mg/dl'],
    ['LAB-SBILI', 'BIOCHEMISTRY', 'Blood (Serum)', 'S. Bilirubin', 'mg/dl'],
    ['LAB-SGOT', 'BIOCHEMISTRY', 'Blood (Serum)', 'SGOT', 'U/l'],
    ['LAB-SGPT', 'BIOCHEMISTRY', 'Blood (Serum)', 'SGPT', 'U/l'],
    ['LAB-ALKP', 'BIOCHEMISTRY', 'Blood (Serum)', 'Alkaline Phosphatase', 'U/l'],
    ['LAB-ACIDP', 'BIOCHEMISTRY', 'Blood (Serum)', 'Acid Phosphatase', 'U/l'],
    ['LAB-URIC', 'BIOCHEMISTRY', 'Blood (Serum)', 'S. Uric Acid', 'mg/dl'],
    ['LAB-ELECTRO', 'BIOCHEMISTRY', 'Blood (Serum)', 'Electrolyte', 'mEq/L'],
    ['LAB-T3T4TSH', 'BIOCHEMISTRY', 'Blood (Serum)', 'T3, T4, TSH', undefined],
    ['LAB-PSA', 'BIOCHEMISTRY', 'Blood (Serum)', 'PSA', 'ng/ml'],
    ['LAB-CA125', 'BIOCHEMISTRY', 'Blood (Serum)', 'CA-125', 'U/ml'],
    ['LAB-FERRITIN', 'BIOCHEMISTRY', 'Blood (Serum)', 'Ferritin', 'ng/ml'],
    ['LAB-VITB12', 'BIOCHEMISTRY', 'Blood (Serum)', 'Vitamin B12', 'pg/ml'],
    ['LAB-FSH', 'BIOCHEMISTRY', 'Blood (Serum)', 'FSH', 'mIU/ml'],
    ['LAB-LH', 'BIOCHEMISTRY', 'Blood (Serum)', 'LH', 'mIU/ml'],
    ['LAB-PRL', 'BIOCHEMISTRY', 'Blood (Serum)', 'Prolactin', 'ng/ml'],
    ['LAB-TSH', 'BIOCHEMISTRY', 'Blood (Serum)', 'TSH', 'µIU/ml'],
    ['LAB-VITD', 'BIOCHEMISTRY', 'Blood (Serum)', 'Vitamin D', 'ng/ml'],
    ['LAB-HSCRP', 'BIOCHEMISTRY', 'Blood (Serum)', 'hs C.R.P', 'mg/L'],
    ['LAB-WIDAL', 'SEROLOGY', 'Blood (Serum)', 'Blood Widal', undefined],
    ['LAB-RASLIDE', 'SEROLOGY', 'Blood (Serum)', 'Rheumatoid Factor (Slide)', undefined],
    ['LAB-ASOSLIDE', 'SEROLOGY', 'Blood (Serum)', 'A.S.O Titer (Slide)', undefined],
    ['LAB-ASOQUANT', 'SEROLOGY', 'Blood (Serum)', 'A.S.O Titer (Quantitative)', 'IU/ml'],
    ['LAB-CRPSLIDE', 'SEROLOGY', 'Blood (Serum)', 'C.R.P (Slide)', undefined],
    ['LAB-CRPQUANT', 'SEROLOGY', 'Blood (Serum)', 'C.R.P (Quantitative)', 'mg/L'],
    ['LAB-HBSAGELISA', 'SEROLOGY', 'Blood (Serum)', 'HBsAg (ELISA)', undefined],
    ['LAB-VDRL', 'SEROLOGY', 'Blood (Serum)', 'VDRL (RPR)', undefined],
    ['LAB-MALARIAAG', 'SEROLOGY', 'Blood', 'Malaria Antigen', undefined],
    ['LAB-DENGUE', 'SEROLOGY', 'Blood (Serum)', 'Dengue', undefined],
    ['LAB-CHIKUN', 'SEROLOGY', 'Blood (Serum)', 'Chikungunya', undefined],
    ['LAB-PAPSMEAR', 'CLINICAL_PATHOLOGY', 'Cervical smear', 'Pap Smear', undefined],
    ['LAB-SEMEN', 'CLINICAL_PATHOLOGY', 'Semen', 'Semen Analysis', undefined],
    ['LAB-URINEALB', 'CLINICAL_PATHOLOGY', 'Urine', 'Urine Albumin', undefined],
    ['LAB-URINEBILEPIG', 'CLINICAL_PATHOLOGY', 'Urine', 'Urine Bile Pigment', undefined],
    ['LAB-URINEBILESALT', 'CLINICAL_PATHOLOGY', 'Urine', 'Urine Bile Salt', undefined],
    ['LAB-URINEPREG', 'CLINICAL_PATHOLOGY', 'Urine', 'Urine Pregnancy Test', undefined],
    ['LAB-URINESUGAR', 'CLINICAL_PATHOLOGY', 'Urine', 'Urine Sugar', undefined],
    ['LAB-URINECULT', 'MICROBIOLOGY', 'Urine', 'Urine Culture & Sensitivity', undefined],
    ['LAB-SPUTUMAFB', 'MICROBIOLOGY', 'Sputum', 'Sputum for A.F.B.', undefined],
    ['LAB-STOOLRM', 'CLINICAL_PATHOLOGY', 'Stool', 'Stool Routine & Micro', undefined],
    ['LAB-STOOLRED', 'CLINICAL_PATHOLOGY', 'Stool', 'Stool Reducing Sugar', undefined],
  ] as [string, Discipline, string, string, string | undefined][]).map(
    ([serviceCode, discipline, specimenType, paramName, unit]) => ({
      serviceCode,
      discipline,
      specimenType,
      demoGrade: true,
      parameters: [{ name: paramName, unit }],
    }),
  ),
];
