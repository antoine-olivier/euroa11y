// European Accessibility Act (Directive (EU) 2019/882): does a business's service fall under it?
// Deterministic, services only (products are out of this plugin's scope). Rules read on EUR-Lex on 2026-10-05:
// - Art. 2(2): services provided to consumers — electronic communications (except transmission services for
//   machine-to-machine services), access to audiovisual media services, elements of passenger transport services
//   (for urban, suburban and regional transport, only interactive self-service terminals), consumer banking,
//   e-books, e-commerce. Art. 2(3): answering emergency calls to 112.
// - Art. 3(30): e-commerce is a service provided at a distance, through websites and apps, with a view to
//   concluding a consumer contract. Recital 35: urban and regional transport websites selling tickets fall there.
// - Art. 3(23) and 4(5): microenterprises providing services are exempt — fewer than 10 persons and annual
//   turnover or balance sheet total not exceeding EUR 2 million. Recital 53: as defined by Recommendation
//   2003/361/EC (partner and linked enterprises added in; 25% or more public control excludes the status).
//   France, consumer code art. L412-13 (law 2023-171 art. 16): same thresholds.
// - Art. 31(2): applies from 28 June 2025. Art. 32(1): services may use products lawfully used before until
//   28 June 2030; service contracts agreed before 28 June 2025 continue until they expire, five years at most.
// - Recital 46: public-sector websites fall under Directive (EU) 2016/2102 (in France, the RGAA); when they provide
//   a service the EAA lists, they must comply with the EAA in addition.

export const EAA_SECTORS = [
  "e_commerce",
  "consumer_banking",
  "e_books",
  "electronic_communications",
  "audiovisual_media_access",
  "passenger_transport",
  "urban_regional_transport",
  "other",
] as const;
export type EaaSector = (typeof EAA_SECTORS)[number];

export interface EaaInput {
  sector: EaaSector;
  sells_to_eu_consumers: boolean;
  public_body?: boolean;
  employees?: number;
  annual_turnover_eur?: number;
  balance_sheet_eur?: number;
}

export const EAA_VERDICTS = ["in_scope", "terminals_only", "exempt_microenterprise", "out_of_scope", "public_sector_other_law", "need_more_info"] as const;
export type EaaVerdict = (typeof EAA_VERDICTS)[number];

export interface EaaResult {
  verdict: EaaVerdict;
  reasons: string[];
  key_dates: string[];
  sources: Array<{ label: string; url: string }>;
  disclaimer: string;
}

const MICRO_EMPLOYEES = 10;
const MICRO_FINANCIAL_EUR = 2_000_000;

const SECTOR_LABELS: Record<Exclude<EaaSector, "other">, string> = {
  e_commerce: "e-commerce services",
  consumer_banking: "consumer banking services",
  e_books: "e-books and dedicated software",
  electronic_communications: "electronic communications services (machine-to-machine transmission excepted)",
  audiovisual_media_access: "services providing access to audiovisual media services",
  passenger_transport: "elements of air, bus, rail and waterborne passenger transport services (websites, apps, e-tickets, travel information, self-service terminals)",
  urban_regional_transport: "urban, suburban and regional transport services",
};

const SOURCES = [
  { label: "Directive (EU) 2019/882, art. 2, 3, 4, 31 and 32, recitals 35, 46 and 53 (EUR-Lex)", url: "https://eur-lex.europa.eu/eli/dir/2019/882/oj/eng" },
  { label: "Commission Recommendation 2003/361/EC, definition of microenterprises (EUR-Lex)", url: "https://eur-lex.europa.eu/eli/reco/2003/361/oj/eng" },
  { label: "France, consumer code art. L412-13, from law no. 2023-171 art. 16 (Légifrance)", url: "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000047284913" },
];

const KEY_DATES = [
  "28 June 2025: the requirements apply to services provided to consumers from that date (art. 31(2)).",
  "Service contracts agreed before 28 June 2025 may continue unchanged until they expire, for five years at most (art. 32(1)).",
  "28 June 2030: end of the transitional period in which a provider may keep providing its services with products it lawfully used for similar services before that date (art. 32(1)).",
];

const DISCLAIMER = "Informational reading of the EAA, not legal advice. National transpositions add their own penalties and procedures; check with a lawyer for a binding answer.";

const PUBLIC_SECTOR = "Public-sector body: its websites and apps fall under the Web Accessibility Directive (EU) 2016/2102 (in France, the RGAA)";

const COUNTING =
  "The figures are those of the latest approved accounts, turnover excluding VAT, with those of partner and linked enterprises added in (Recommendation 2003/361/EC, recital 53): a subsidiary of a larger group is usually not a microenterprise. The exemption stops once the business is no longer one.";

const TERMINALS_ONLY = [
  "For urban, suburban and regional transport, the EAA covers only the interactive self-service terminals located in the EU (art. 2(2)(c)(v)), not the website or the app.",
  "If the website or app sells tickets or passes to consumers, that is an e-commerce service (art. 3(30), recital 35): check it again with sector e_commerce.",
];

export interface EaaReminder {
  rule: string[];
  next_step: string;
  sources: Array<{ label: string; url: string }>;
}

/**
 * Attached to every scan report. In the ChatGPT trials of 2026-10-03, check_eaa_scope was never called: the model
 * searched the web instead and once contradicted itself. The rule now sits in the context the scan already put there.
 */
export const EAA_REMINDER: EaaReminder = {
  rule: [
    "Since 28 June 2025, the European Accessibility Act (Directive (EU) 2019/882) requires these services offered to EU consumers to be accessible, websites and apps included: e-commerce, consumer banking, e-books, electronic communications, access to audiovisual media, and passenger transport (for urban, suburban and regional transport, self-service terminals only).",
    `Microenterprises providing services are exempt: fewer than ${MICRO_EMPLOYEES} persons, and an annual turnover or a balance sheet total not above EUR 2 million, partner and linked enterprises included (France: same thresholds, consumer code art. L412-13).`,
    "Public-sector websites fall under Directive (EU) 2016/2102 (in France, the RGAA), and also under the EAA when they provide one of these services.",
  ],
  next_step: "To tell whether the EAA applies to the business behind this page, ask which of these services it offers, its headcount and its annual turnover, then call check_eaa_scope, which applies these rules to the figures.",
  sources: SOURCES.filter((source) => !source.url.includes("/reco/")),
};

export function checkEaaScope(input: EaaInput): EaaResult {
  const result = (verdict: EaaVerdict, reasons: string[]): EaaResult => ({ verdict, reasons, key_dates: KEY_DATES, sources: SOURCES, disclaimer: DISCLAIMER });

  if (input.sector === "other" || !input.sells_to_eu_consumers) {
    const reasons =
      input.sector === "other"
        ? [
            "The EAA covers these consumer services (art. 2(2)): e-commerce, consumer banking, e-books, electronic communications, access to audiovisual media, and passenger transport; and answering emergency calls to 112 (art. 2(3)).",
            "If consumers can order, book or subscribe through the website or app, that is an e-commerce service (art. 3(30)): check it again with sector e_commerce.",
            "Products (computers, smartphones, self-service terminals, e-readers…) have their own requirements, not assessed here.",
          ]
        : [`The EAA covers ${SECTOR_LABELS[input.sector]} provided to consumers in the EU (art. 2(2)); a business-to-business-only service is not covered.`];
    if (input.public_body) return result("public_sector_other_law", [`${PUBLIC_SECTOR}; the EAA adds its requirements only for the consumer services it lists (recital 46).`, ...reasons]);
    return result("out_of_scope", reasons);
  }

  const terminalsOnly = input.sector === "urban_regional_transport";
  const covered: EaaVerdict = terminalsOnly ? "terminals_only" : "in_scope";
  const label = SECTOR_LABELS[input.sector];
  const reasons = [`${label[0]?.toUpperCase()}${label.slice(1)} provided to EU consumers are listed in article 2(2) of the EAA.`];
  const tail = terminalsOnly ? TERMINALS_ONLY : [];

  if (input.public_body) {
    return result(covered, [
      ...reasons,
      `${PUBLIC_SECTOR}, and the EAA applies to this service in addition (recital 46).`,
      "The microenterprise exemption does not apply: under Recommendation 2003/361/EC, an enterprise 25% or more controlled by public bodies is not a microenterprise.",
      ...tail,
    ]);
  }
  if (input.employees === undefined) {
    return result("need_more_info", [...reasons, "Microenterprises providing services are exempt: give the headcount, and the annual turnover or balance sheet total, to decide."]);
  }
  if (input.employees >= MICRO_EMPLOYEES) {
    return result(covered, [...reasons, `${input.employees} employees: not a microenterprise (fewer than ${MICRO_EMPLOYEES} persons), so the exemption does not apply.`, ...tail]);
  }
  const financial = [input.annual_turnover_eur, input.balance_sheet_eur].filter((value): value is number => value !== undefined);
  if (financial.length === 0) {
    return result("need_more_info", [...reasons, `Fewer than ${MICRO_EMPLOYEES} employees: the business is exempt if its annual turnover or its balance sheet total does not exceed EUR 2 million. Give one of the two figures.`]);
  }
  if (financial.some((value) => value <= MICRO_FINANCIAL_EUR)) {
    return result("exempt_microenterprise", [
      ...reasons,
      `Fewer than ${MICRO_EMPLOYEES} employees and turnover or balance sheet total not above EUR 2 million: microenterprise, exempt from the accessibility requirements for services (art. 4(5); France: consumer code art. L412-13).`,
      COUNTING,
    ]);
  }
  if (financial.length === 1) {
    const missing = input.annual_turnover_eur === undefined ? "annual turnover" : "balance sheet total";
    return result("need_more_info", [...reasons, `Fewer than ${MICRO_EMPLOYEES} employees and the figure given is above EUR 2 million: the business is still exempt if its ${missing} does not exceed EUR 2 million. Give that figure.`]);
  }
  return result(covered, [...reasons, `Fewer than ${MICRO_EMPLOYEES} employees, but both turnover and balance sheet total above EUR 2 million: not a microenterprise.`, ...tail]);
}
