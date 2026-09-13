/**
 * Reference service catalogue and rates.
 *
 * PROVENANCE — every rate here is transcribed from a source document in
 * `pricing/`, and each entry records which one. Nothing is invented: where a
 * source names a service but publishes no rate, `amount` is null and the
 * service is seeded unpriced (orderable as a package component, refused for
 * standalone billing until an administrator prices it).
 *
 * Sources:
 *   A2    CGHS Annexure A-2 — Unit Cost of Ayurvedic therapies/interventions
 *         in OPD/IPD offered to NABH accredited empanelled Hospitals in CGHS.
 *   Y2    CGHS Annexure Y-2 — Unit Cost of Yoga therapies/interventions.
 *   BOARD Pt. Khushilal Sharma Govt. Ayurveda Institute pathology rate list.
 *   RCPT  OPD Bill Receipt (cash book series 43096 / 43351 of 2026).
 *
 * CAVEAT — A2/Y2 are CGHS reimbursement benchmarks and BOARD/RCPT belong to a
 * different (CGHS-empanelled Ayurveda) institute. They are seeded as a starting
 * catalogue, marked "pending administrative approval", and must be reviewed by
 * hospital administration before being used to bill a real patient. The rate
 * board and the receipts cross-validate on every test they share (Random Blood
 * Sugar ₹30, S. Uric Acid ₹50, T3/T4/TSH ₹250), which is why the lab catalogue
 * is seeded from the board with reasonable confidence.
 *
 * PROVISIONAL DEFAULTS (sourceReference "Provisional default rate") — a small
 * set of services the workflow bills on every OPD visit and IPD stay have no
 * rate anywhere in the source material: the general OPD consultation, the
 * general-ward bed-day, and two Ayurvedic examination fees. Leaving them
 * unpriced left a patient's ledger empty even after a full OPD + IPD episode,
 * so they are seeded here with deliberately round starting amounts for a
 * government general hospital. These are NOT sourced rates — they exist only
 * so the ChargeItem → Ledger → Payment → Receipt chain is live out of the box,
 * and are meant to be reviewed and corrected in Super Admin → Service Pricing
 * before go-live. Like every other seeded price, the seed writes them once and
 * never overwrites an amount an administrator has since changed.
 */

export interface SeedCategory {
  code: string;
  name: string;
  sortOrder: number;
}

export interface SeedService {
  code: string;
  name: string;
  categoryCode: string;
  serviceType:
    | 'CONSULTATION'
    | 'TEST'
    | 'THERAPY'
    | 'PROCEDURE'
    | 'PACKAGE'
    | 'BED_DAY'
    | 'CARE_PER_DAY';
  applicability?: 'OPD' | 'IPD' | 'BOTH';
  unit?: 'SITTING' | 'SESSION' | 'DAY' | 'COURSE' | 'TEST' | 'VISIT';
  /** null = source names the service but publishes no rate. Seeded unpriced. */
  amount: number | null;
  sourceReference: string;
  description?: string;
  courseDurationDays?: number;
  /** Component service codes, for PACKAGE rows. */
  components?: string[];
}

export const SEED_CATEGORIES: SeedCategory[] = [
  { code: 'RN', name: 'Roga Nidan (Pathology)', sortOrder: 10 },
  { code: 'URINE', name: 'Urine Test', sortOrder: 20 },
  { code: 'SPUTUM', name: 'Sputum Test', sortOrder: 30 },
  { code: 'STOOL', name: 'Stool Test', sortOrder: 40 },
  { code: 'PANCHAKARMA', name: 'Panchakarma & Ayurvedic Therapy', sortOrder: 50 },
  { code: 'YOGA', name: 'Yoga & Naturopathy', sortOrder: 60 },
  { code: 'CONSULT', name: 'Consultation', sortOrder: 70 },
  { code: 'IPDACC', name: 'IPD Accommodation', sortOrder: 80 },
  { code: 'PROCCARE', name: 'Procedure Care', sortOrder: 90 },
];

/** CGHS Annexure A-2 — 97 Ayurvedic therapies. Single unit cost, valid OPD and IPD. */
const AYURVEDA: [number, string, number][] = [
  [1, 'Abhyanga', 1145],
  [2, 'Abhyanga-Sthanika', 570],
  [3, 'Abhyanga+Sweda', 1280],
  [4, 'Avagaha', 765],
  [5, 'Anjana', 340],
  [6, 'Aanchana (Traction)', 480],
  [7, 'Annalepa/Njavaratheppu-Full Body', 1290],
  [8, 'Annalepa/Njavaratheppu-Sthanikam', 755],
  [9, 'Aschothana', 335],
  [10, 'Agnikarma-Infra Red Coagulation', 10000],
  [11, 'Agnikarma-High frequency Coagulation', 10000],
  [12, 'Agnikarma-Radio frequency Coagulation', 10000],
  [13, 'Achasnehapana', 440],
  [14, 'Bhedana (of Eye)', 565],
  [15, 'BhagnaBandhana (Fracture Bandage with Reduction & Immobilisation)', 885],
  [16, 'Choorna Pinda Sweda/Podikkizhi-Full Body', 1210],
  [17, 'Choorna Pinda Sweda/Podikkizhi-Sthanika/Ekangam', 715],
  [18, 'DhanyaPindaswedam/Dhanyakkizhi/Navadhanyakkizhi-Full Body', 1245],
  [19, 'Dhara/Sirodhara-Thaila', 1420],
  [20, 'Dhanyamladhara-Sthanika/Local-Katee Dhara etc', 705],
  [21, 'Dhoopana', 480],
  [22, 'Dhoomapana', 460],
  [23, 'Dhanyamla Pindaweda/Dhanyamlakkizhi/Kaatikkizhi-Full Body', 1240],
  [24, 'Eshana', 565],
  [25, 'Greevavasthi', 845],
  [26, 'Gandoosha', 390],
  [27, 'Goshbanabandha', 300],
  [28, 'Jaloukavacharana', 745],
  [29, 'Jambeerapindasweda/Narangakkizhi-Full Body', 1190],
  [30, 'Januvasthi', 845],
  [31, 'Kabala', 390],
  [32, 'Kateevasthi', 845],
  [33, 'Kashayavasthi (Niroohavasthi)-Different varieties', 1030],
  [34, 'KashayaDhara-Full Body', 1045],
  [35, 'KashayaDhara-Ekangam/Local', 635],
  [36, 'KsheeraDhara (Medicated-different varieties)-Full Body', 1155],
  [37, 'KsheeraDhooma', 735],
  [38, 'Kshara Karma', 10000],
  [39, 'Ksharasoothra-Low level fistula', 10000],
  [40, 'Ksharasoothra-Middle level fistula', 10000],
  [41, 'Ksharasoothra-High level fistula', 10000],
  [42, 'Kshalana', 355],
  [43, 'Kshara Pathana', 10000],
  [44, 'Karnapoorana', 350],
  [45, 'Kuttanam', 540],
  [46, 'Lekhana', 540],
  [47, 'Lepa/Lepana-Local', 390],
  [48, 'Mathravasthi', 350],
  [49, 'MamsaPindaSweda/Mamsakkizhi-Full Body', 1420],
  [50, 'MamsaPindaSweda/Mamsakkizhi-Sthanikam/Ekangam', 820],
  [51, 'Mukhalepa', 490],
  [52, 'Moordhataila', 315],
  [53, 'Nadeesweda/Snigdhasweda-Full', 580],
  [54, 'Nadeesweda/Snigdhasweda-Ekangam/Local', 450],
  [55, 'Nethradhara/Akshiseka', 595],
  [56, 'Nasya', 600],
  [57, 'PathraPindaSweda/Ilakkizhi-Full', 1220],
  [58, 'PathraPindaSweda/Ilakkizhi-Sthanika/Ekangam', 720],
  [59, 'Pizhichil/Kayaseka', 1995],
  [60, 'Pizhichil-Sthanikam/Ekangam/Local', 1105],
  [61, 'Pichu', 410],
  [62, 'Prushtavasthi', 845],
  [63, 'Putapaka', 850],
  [64, 'Prachanna', 590],
  [65, 'Pindi', 450],
  [66, 'ShashtikapindaSweda/Navarakkizhi-Full Body', 1320],
  [67, 'ShashtikapindaSweda/Navarakkizhi-Ekangam/Sthanikam', 770],
  [68, 'Sirovasthi', 970],
  [69, 'Snehapana', 440],
  [70, 'Sirolepa/Thalapothichil', 1120],
  [71, 'Siravayadha/Siravedha/Rakthamoksha', 640],
  [72, 'Taila Vasthi', 710],
  [73, 'Thakradhara', 1145],
  [74, 'Thalam', 410],
  [75, 'Tharpana', 735],
  [76, 'Tailadaha', 10000],
  [77, 'Thakrapana', 250],
  [78, 'Utharavasthi', 1100],
  [79, 'Udwarthana', 1095],
  [80, 'Urovasthi', 845],
  [81, 'Upanaha/Upanahasweda', 590],
  [82, 'Vamana', 745],
  [83, 'Virechana', 355],
  [84, 'Valukasweda/Manalkkizhi-Full Body', 1080],
  [85, 'Vitalaka/Bitalaka', 450],
  [86, 'Yoniprakshalana', 500],
  [87, 'Yonidhavana', 500],
  [88, 'Yoni Pichu', 460],
  [89, 'Yoni Poorana', 460],
  [90, 'Yoni Dhoopana', 335],
  [91, 'Valukasweda/Manalkkizhi-Sthanikam', 655],
  [92, 'Ksheeradhara-Head', 1095],
  [93, 'Jambeerapindasweda/Narangakkizhi-Sthanika/Local', 735],
  [94, 'Dhanyapindasweda-Sthanika/Local', 730],
  [95, 'Dhanyamlapindasweda/Katikkizhi-Sthanika', 705],
  [96, 'Veshtanam', 330],
  [97, 'Agnikarma (Classical with Panchalohasalaka)', 995],
];

/**
 * A-2 rows whose name states "Package rate for full course of treatment".
 * These bill once per course, not per session — see TherapyService in P4.
 */
const AYURVEDA_COURSE_PACKAGES = new Set([10, 11, 12, 38, 39, 40, 41, 43, 76]);

/** A-2 rows priced per day rather than per sitting. */
const AYURVEDA_PER_DAY = new Set([13, 69]);

/** CGHS Annexure Y-2 — 27 Yoga therapies. Setting is part of the row identity. */
const YOGA: [number, string, number, 'OPD' | 'IPD', boolean][] = [
  [1, 'Jalaneti', 50, 'OPD', false],
  [2, 'Sutra Neti', 50, 'OPD', false],
  [3, 'Dugdhaneti', 100, 'OPD', false],
  [4, 'Ghritaneti', 100, 'OPD', false],
  [5, 'Kunjala/Vamanadhouti', 100, 'OPD', false],
  [6, 'Vastradhouti', 100, 'OPD', false],
  [7, 'Jalabasti', 150, 'OPD', false],
  [8, 'Sthalabasti', 50, 'OPD', false],
  [9, 'Moolashodhana/Chakri Karma', 50, 'OPD', false],
  [10, 'Shankhaprakshalana (with therapeutic diet)', 500, 'OPD', false],
  [11, 'Kapalabhati', 25, 'OPD', false],
  [12, 'Nauli', 50, 'OPD', false],
  [13, 'Trataka (Jyoti)', 50, 'OPD', false],
  [14, 'Shat Karma Package-I (Jalaneti, Sutra Neti and Kapalabhati)', 150, 'OPD', true],
  [
    15,
    'Shat Karma Package-II (Jalaneti, Sutra Neti, Kunjala/Vastra Dhauti and Kapalabhati)',
    200,
    'OPD',
    true,
  ],
  [
    16,
    'Trataka Package (Jatrutrataka, Jyoti Trataka, Eye wash and relaxation technique)',
    100,
    'OPD',
    true,
  ],
  [
    17,
    'Individual Yoga Therapy Session (Yogic Sukshmavyayama, Surya Namaskar, Yogasana, Relaxation)',
    100,
    'OPD',
    false,
  ],
  [18, 'Individual Pranayama/Dhyana (Meditation) Session', 100, 'OPD', false],
  [
    19,
    'One day individual Yoga therapy package (Shatkarma, Yogasana, Pranayama, Dhyana)',
    250,
    'OPD',
    true,
  ],
  [20, 'One week individual Yoga therapy package (minimum 1 hour daily)', 500, 'OPD', true],
  [21, 'One month individual Yoga therapy package (minimum 1 hour daily)', 1500, 'OPD', true],
  [22, 'One week Yoga therapy package (3-4 hours per day)', 1500, 'OPD', true],
  [23, 'Two weeks Yoga therapy package (3-4 hours per day)', 2500, 'OPD', true],
  [24, 'One month Yoga therapy package (3-4 hours per day)', 5000, 'OPD', true],
  [25, 'One week Yoga therapy package (Indoor)', 10000, 'IPD', true],
  [26, 'Two weeks Yoga therapy package (Indoor)', 18000, 'IPD', true],
  [27, 'Three weeks Yoga therapy package (Indoor)', 25000, 'IPD', true],
];

/** Course lengths in days, where the Y-2 row name states one. */
const YOGA_COURSE_DAYS: Record<number, number> = {
  19: 1,
  20: 7,
  21: 30,
  22: 7,
  23: 14,
  24: 30,
  25: 7,
  26: 14,
  27: 21,
};

/** Institute pathology rate board. [code suffix, name, rate, categoryCode]. */
const LAB_TESTS: [string, string, number | null, string][] = [
  // --- Pathology (left column of the board) ---
  ['HB', 'Hb%', 20, 'RN'],
  ['TLCDLC', 'TLC & DLC', 50, 'RN'],
  ['CBC', 'CBC (Complete Blood Count)', 150, 'RN'],
  ['ESR', 'ESR', 20, 'RN'],
  ['RETIC', 'Reticulocyte Count', 50, 'RN'],
  ['PSMP', 'P.S. for M.P.', 30, 'RN'],
  ['FBS', 'Fasting Blood Sugar', 30, 'RN'],
  ['PPBS', 'PP Blood Sugar', 30, 'RN'],
  ['RBS', 'Random Blood Sugar', 30, 'RN'],
  ['GTT', 'G.T.T. (Glucose powder 100gm provided by patient)', 150, 'RN'],
  ['HBA1C', 'HbA1C', 270, 'RN'],
  ['UREA', 'Urea', 50, 'RN'],
  ['CREAT', 'Creatinine', 50, 'RN'],
  ['CALCIUM', 'Calcium', 150, 'RN'],
  ['CHOL', 'Cholesterol', 50, 'RN'],
  ['HDL', 'HDL Cholesterol', 50, 'RN'],
  ['TRIG', 'Triglyceride', 100, 'RN'],
  ['SBILI', 'S. Bilirubin', 50, 'RN'],
  ['SGOT', 'SGOT', 50, 'RN'],
  ['SGPT', 'SGPT', 50, 'RN'],
  ['ALKP', 'Alkaline Phosphatase', 50, 'RN'],
  ['ACIDP', 'Acid Phosphatase', 50, 'RN'],
  ['WIDAL', 'Blood Widal', 50, 'RN'],
  ['RASLIDE', 'Rheumatoid Factor (Slide method)', 60, 'RN'],
  ['RAQUANT', 'Rheumatoid Factor (Quantitative)', 200, 'RN'],
  ['ASOSLIDE', 'A.S.O Titer (Slide method)', 60, 'RN'],
  ['ASOQUANT', 'A.S.O Titer (Quantitative)', 200, 'RN'],
  ['CRPSLIDE', 'C.R.P (Slide method)', 80, 'RN'],
  ['CRPQUANT', 'C.R.P (Quantitative)', 200, 'RN'],
  ['HSCRP', 'hs C.R.P (Quantitative)', 250, 'RN'],
  ['HBSAG', 'Hepatitis B Surface Antigen (HBsAg)', 80, 'RN'],
  ['HBSAGELISA', 'Hepatitis B Surface Antigen (HBsAg) by ELISA', 250, 'RN'],
  // --- Pathology (right column of the board) ---
  ['LIPID', 'Lipid Profile', 200, 'RN'],
  ['LFT', 'L.F.T. (Liver Function Test)', 200, 'RN'],
  ['KFT', 'K.F.T. (Kidney Function Test)', 200, 'RN'],
  ['CTBT', 'C.T. B.T. (Clotting Time & Bleeding Time)', 20, 'RN'],
  ['URIC', 'S. Uric Acid', 50, 'RN'],
  ['VDRL', 'VDRL (RPR)', 50, 'RN'],
  ['MALARIAAG', 'Malaria Antigen', 100, 'RN'],
  ['BLOODGRP', 'Blood Group & Rh', 30, 'RN'],
  ['SEMEN', 'Semen Analysis', 70, 'RN'],
  ['ELECTRO', 'Electrolyte', 120, 'RN'],
  ['T3T4TSH', 'T3, T4, TSH', 250, 'RN'],
  ['PSA', 'PSA', 450, 'RN'],
  ['CA125', 'CA-125', 450, 'RN'],
  ['FERRITIN', 'Ferritin', 250, 'RN'],
  ['VITB12', 'Vitamin B12', 450, 'RN'],
  ['DENGUE', 'Dengue', 400, 'RN'],
  ['CHIKUN', 'Chikungunya', 400, 'RN'],
  ['FSH', 'FSH', 200, 'RN'],
  ['LH', 'LH', 200, 'RN'],
  ['PRL', 'PRL (Prolactin)', 200, 'RN'],
  ['TSH', 'TSH', 150, 'RN'],
  ['VITD', 'Vitamin D', 450, 'RN'],
  ['PAPSMEAR', 'Pap Smear', 120, 'RN'],
  // --- Urine ---
  ['URINERM', 'Urine Routine & Micro', 30, 'URINE'],
  ['URINEBILESALT', 'Urine for Bile Salt', 20, 'URINE'],
  ['URINEBILEPIG', 'Urine for Bile Pigment', 20, 'URINE'],
  ['URINESUGAR', 'Urine Sugar', 20, 'URINE'],
  ['URINEALB', 'Urine Albumin', 20, 'URINE'],
  ['URINEPREG', 'Urine for Pregnancy Test', 50, 'URINE'],
  ['URINECULT', 'Urine Culture & Sensitivity', 200, 'URINE'],
  // --- Sputum ---
  ['SPUTUMAFB', 'Sputum for A.F.B.', 50, 'SPUTUM'],
  // --- Stool ---
  ['STOOLRM', 'Stool Routine & Micro', 30, 'STOOL'],
  ['STOOLRED', 'Stool Reducing Sugar', 20, 'STOOL'],
];

/**
 * Named on the rate board only as a package component, with no standalone rate
 * published anywhere in the source material.
 *
 * [code suffix, name, provisional amount, categoryCode]. HIV is given a
 * provisional standalone rate in line with the board's other rapid
 * immunoassays (HBsAg ₹80); Nadi/Prakrati Pariksha are Ayurvedic examination
 * fees with no published rate and take a round provisional amount. All three
 * are flagged "Provisional default rate" and expected to be reviewed in
 * Service Pricing.
 */
const COMPONENT_ONLY_TESTS: [string, string, number, string][] = [
  ['HIV', 'HIV I & II Antibody', 80, 'RN'],
  ['NADI', 'Nadi Pariksha', 100, 'RN'],
  ['PRAKRATI', 'Prakrati Pariksha', 100, 'RN'],
];

export function buildSeedServices(): SeedService[] {
  const services: SeedService[] = [];

  // ── Ayurvedic therapies (A-2) ──────────────────────────────────────────
  for (const [sno, name, amount] of AYURVEDA) {
    const isCourse = AYURVEDA_COURSE_PACKAGES.has(sno);
    const isPerDay = AYURVEDA_PER_DAY.has(sno);
    services.push({
      code: `AYU-${String(sno).padStart(3, '0')}`,
      name: isCourse ? `${name} (full course)` : name,
      categoryCode: 'PANCHAKARMA',
      serviceType: isCourse ? 'PACKAGE' : 'THERAPY',
      // A-2 is titled "in OPD/IPD": one rate valid in both settings.
      applicability: 'BOTH',
      unit: isCourse ? 'COURSE' : isPerDay ? 'DAY' : 'SITTING',
      amount,
      sourceReference: `CGHS Annexure A-2, S.No ${sno}`,
      description: isCourse
        ? 'Package rate for the full course of treatment.'
        : isPerDay
          ? 'Charged per day of treatment.'
          : undefined,
    });
  }

  // ── Yoga therapies (Y-2) ───────────────────────────────────────────────
  for (const [sno, name, amount, setting, isPackage] of YOGA) {
    services.push({
      code: `YOG-${String(sno).padStart(3, '0')}`,
      name,
      categoryCode: 'YOGA',
      serviceType: isPackage ? 'PACKAGE' : 'THERAPY',
      // Y-2 marks each row (OPD) or (Indoor)/(IPD); the same-named week of
      // therapy is ₹500 in OPD and ₹10,000 as an indoor admission, so the
      // setting belongs to the row rather than to a second rate column.
      applicability: setting,
      unit: isPackage ? 'COURSE' : 'SITTING',
      amount,
      sourceReference: `CGHS Annexure Y-2, S.No ${sno}`,
      courseDurationDays: YOGA_COURSE_DAYS[sno],
    });
  }

  // Y-2 closing note: unlisted minor Naturopathy procedures.
  services.push({
    code: 'YOG-MINOR',
    name: 'Minor/Local Naturopathy Procedure (not separately listed)',
    categoryCode: 'YOGA',
    serviceType: 'PROCEDURE',
    applicability: 'BOTH',
    unit: 'SITTING',
    amount: 100,
    sourceReference: 'CGHS Annexure Y-2, closing note',
    description: 'Chargeable per sitting for up to 28 days.',
  });

  // ── Laboratory tests (rate board) ──────────────────────────────────────
  for (const [suffix, name, amount, categoryCode] of LAB_TESTS) {
    services.push({
      code: `LAB-${suffix}`,
      name,
      categoryCode,
      serviceType: 'TEST',
      applicability: 'BOTH',
      unit: 'TEST',
      amount,
      sourceReference: 'Institute pathology rate board',
    });
  }

  for (const [suffix, name, amount, categoryCode] of COMPONENT_ONLY_TESTS) {
    services.push({
      code: `LAB-${suffix}`,
      name,
      categoryCode,
      serviceType: 'TEST',
      applicability: 'BOTH',
      unit: 'TEST',
      amount,
      sourceReference: 'Provisional default rate',
      description:
        'Named on the rate board only as a package component — no standalone rate is published. ' +
        'Seeded with a provisional starting amount; review in Service Pricing before go-live.',
    });
  }

  // ECG appears on an OPD receipt at ₹50 but not on the pathology board.
  services.push({
    code: 'LAB-ECG',
    name: 'E.C.G.',
    categoryCode: 'RN',
    serviceType: 'TEST',
    applicability: 'BOTH',
    unit: 'TEST',
    amount: 50,
    sourceReference: 'OPD Bill Receipt CASH BOOK-43351/2026 (not on the rate board)',
  });

  // ── Laboratory packages (rate board, with stated components) ───────────
  services.push({
    code: 'PKG-HEALTH1',
    name: 'Health Package - 1',
    categoryCode: 'RN',
    serviceType: 'PACKAGE',
    applicability: 'BOTH',
    unit: 'TEST',
    amount: 550,
    sourceReference: 'Institute pathology rate board',
    components: ['LAB-CBC', 'LAB-LFT', 'LAB-LIPID', 'LAB-KFT', 'LAB-FBS', 'LAB-URINERM'],
  });

  services.push({
    code: 'PKG-HEALTH2',
    name: 'Health Package - 2',
    categoryCode: 'RN',
    serviceType: 'PACKAGE',
    applicability: 'BOTH',
    unit: 'TEST',
    amount: 800,
    sourceReference: 'Institute pathology rate board',
    components: [
      'LAB-CBC',
      'LAB-LFT',
      'LAB-LIPID',
      'LAB-KFT',
      'LAB-FBS',
      'LAB-URINERM',
      'LAB-T3T4TSH',
      'LAB-ECG',
      'LAB-NADI',
      'LAB-PRAKRATI',
    ],
  });

  services.push({
    code: 'PKG-ANC',
    name: 'ANC Profile',
    categoryCode: 'RN',
    serviceType: 'PACKAGE',
    applicability: 'BOTH',
    unit: 'TEST',
    amount: 150,
    sourceReference: 'Institute pathology rate board',
    components: [
      'LAB-CBC',
      'LAB-RBS',
      'LAB-BLOODGRP',
      'LAB-VDRL',
      'LAB-HBSAG',
      'LAB-HIV',
      'LAB-URINERM',
      'LAB-TSH',
    ],
  });

  // ── Pre/post procedure care (A-2 note c) ───────────────────────────────
  services.push({
    code: 'CARE-PREPOST',
    name: 'Pre/Post Procedure Care',
    categoryCode: 'PROCCARE',
    serviceType: 'CARE_PER_DAY',
    applicability: 'BOTH',
    unit: 'DAY',
    amount: 75,
    sourceReference: 'CGHS Annexure A-2, note (c)',
    description:
      'Pre and post procedure cost, chargeable per day. A single rate applies to all therapies; ' +
      'therapy unit rates already include materials, medicines, manpower and diet.',
  });

  // ── Consultation and accommodation ─────────────────────────────────────
  // No source document in pricing/ publishes an ESIC consultation or bed-day
  // rate. Rather than leave them unpriced — which left a patient's ledger
  // empty after a full OPD + IPD episode — they carry deliberately round
  // provisional amounts for a government general hospital. Review in
  // Super Admin → Service Pricing before go-live; the seed never overwrites
  // an amount an administrator has since set.
  const provisionalNote =
    'Provisional starting rate — not from a published source. Review in Service Pricing before go-live.';
  const provisionalRef = 'Provisional default rate';

  services.push(
    {
      code: 'CONSULT-GEN',
      name: 'OPD Consultation - General',
      categoryCode: 'CONSULT',
      serviceType: 'CONSULTATION',
      applicability: 'OPD',
      unit: 'VISIT',
      amount: 20,
      sourceReference: provisionalRef,
      description: provisionalNote,
    },
    {
      code: 'CONSULT-SPEC',
      name: 'OPD Consultation - Specialist',
      categoryCode: 'CONSULT',
      serviceType: 'CONSULTATION',
      applicability: 'OPD',
      unit: 'VISIT',
      amount: 50,
      sourceReference: provisionalRef,
      description: provisionalNote,
    },
    {
      code: 'CONSULT-FOLLOWUP',
      name: 'OPD Consultation - Follow-up',
      categoryCode: 'CONSULT',
      serviceType: 'CONSULTATION',
      applicability: 'OPD',
      unit: 'VISIT',
      amount: 10,
      sourceReference: provisionalRef,
      description: provisionalNote,
    },
    {
      code: 'BED-GENERAL',
      name: 'IPD Bed - General Ward',
      categoryCode: 'IPDACC',
      serviceType: 'BED_DAY',
      applicability: 'IPD',
      unit: 'DAY',
      amount: 500,
      sourceReference: provisionalRef,
      description:
        'Provisional per-day charge for a general-ward bed — the standard ward for this ' +
        'government hospital. Review in Service Pricing before go-live.',
    },
    // Semi-private / private beds are not used by this government general
    // hospital (general wards only), but the bed-day services still exist in
    // the catalogue and IpdFinanceService.BED_SERVICE_BY_CATEGORY still maps
    // ward categories A/B to them — so they carry provisional rates too rather
    // than being left as a billing dead end if such a ward is ever created.
    {
      code: 'BED-SEMIPRIVATE',
      name: 'IPD Bed - Semi-Private Room',
      categoryCode: 'IPDACC',
      serviceType: 'BED_DAY',
      applicability: 'IPD',
      unit: 'DAY',
      amount: 1000,
      sourceReference: provisionalRef,
      description: provisionalNote,
    },
    {
      code: 'BED-PRIVATE',
      name: 'IPD Bed - Private Room',
      categoryCode: 'IPDACC',
      serviceType: 'BED_DAY',
      applicability: 'IPD',
      unit: 'DAY',
      amount: 2000,
      sourceReference: provisionalRef,
      description: provisionalNote,
    },
  );

  return services;
}

/** Reason recorded against every seeded price version. */
export const SEED_PRICE_REASON =
  'Initial seed from CGHS/institute reference material — pending administrative approval';
