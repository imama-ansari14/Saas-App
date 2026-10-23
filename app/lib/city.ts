// City names as customers type them at checkout are messy: "khi", "Karachi.", "KARACHI SADDAR".
// This keeps the city RTO table honest by folding the common variants together.

const ALIASES: Record<string, string> = {
  khi: "karachi",
  karachi: "karachi",
  krachi: "karachi",
  karaachi: "karachi",
  lhr: "lahore",
  lahore: "lahore",
  lahor: "lahore",
  isb: "islamabad",
  islamabad: "islamabad",
  islambad: "islamabad",
  rwp: "rawalpindi",
  rawalpindi: "rawalpindi",
  pindi: "rawalpindi",
  "rawalpindi cantt": "rawalpindi",
  fsd: "faisalabad",
  faisalabad: "faisalabad",
  faislabad: "faisalabad",
  mul: "multan",
  multan: "multan",
  pew: "peshawar",
  peshawar: "peshawar",
  qta: "quetta",
  quetta: "quetta",
  hyd: "hyderabad",
  hyderabad: "hyderabad",
  skt: "sialkot",
  sialkot: "sialkot",
  grw: "gujranwala",
  gujranwala: "gujranwala",
  "d i khan": "dera ismail khan",
  "di khan": "dera ismail khan",
  "dera ismail khan": "dera ismail khan",
  "d g khan": "dera ghazi khan",
  "dg khan": "dera ghazi khan",
  "dera ghazi khan": "dera ghazi khan",
  "r y khan": "rahim yar khan",
  "ry khan": "rahim yar khan",
  "rahim yar khan": "rahim yar khan",
  bwp: "bahawalpur",
  bahawalpur: "bahawalpur",
  sukkur: "sukkur",
  larkana: "larkana",
  mardan: "mardan",
  abbottabad: "abbottabad",
  abbotabad: "abbottabad",
  sargodha: "sargodha",
  sheikhupura: "sheikhupura",
  gujrat: "gujrat",
  sahiwal: "sahiwal",
  okara: "okara",
  "wah cantt": "wah cantt",
  jhelum: "jhelum",
  kasur: "kasur",
  nawabshah: "nawabshah",
  "shaheed benazirabad": "nawabshah",
  mirpurkhas: "mirpur khas",
  "mirpur khas": "mirpur khas",
  mirpur: "mirpur",
  muzaffarabad: "muzaffarabad",
  gilgit: "gilgit",
  swat: "swat",
  mingora: "swat",
  kohat: "kohat",
  chiniot: "chiniot",
  jhang: "jhang",
  vehari: "vehari",
  khanewal: "khanewal",
  "toba tek singh": "toba tek singh",
};

const SUFFIXES = [" city", " cantt", " cantonment", " pakistan", " pk", " district"];

export function normalizeCity(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,/#!$%^&*;:{}=_`~()'"-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  if (ALIASES[s]) return ALIASES[s];
  for (const suffix of SUFFIXES) {
    if (s.endsWith(suffix)) {
      const base = s.slice(0, -suffix.length).trim();
      if (ALIASES[base]) return ALIASES[base];
    }
  }
  // "karachi saddar", "lahore dha phase 5": first word is usually the city
  const first = s.split(" ")[0];
  if (first && ALIASES[first] && first.length > 3) return ALIASES[first];
  const firstTwo = s.split(" ").slice(0, 2).join(" ");
  if (ALIASES[firstTwo]) return ALIASES[firstTwo];
  const firstThree = s.split(" ").slice(0, 3).join(" ");
  if (ALIASES[firstThree]) return ALIASES[firstThree];
  return s;
}

export function cityLabel(normalized: string): string {
  return normalized
    .split(" ")
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}
