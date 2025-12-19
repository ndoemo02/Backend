export function normalize(text) {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/restauracji|restauracja|w|u|na|do/g, '')
    .replace(/[-_]/g, ' ') // 🔧 zamiana myślników na spacje
    .replace(/[^a-ząćęłńóśźż0-9\s]/g, '') // pozwól spacje i polskie znaki
    .replace(/\s+/g, ' ') // 🔧 usuń nadmiarowe spacje
    .trim();
}
