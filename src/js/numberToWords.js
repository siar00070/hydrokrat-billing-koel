// Converts a rupee amount into words, Indian numbering system (lakh/crore),
// e.g. 8282 -> "Eight Thousand Two Hundred Eighty Two Rupees Only".

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function threeDigitsToWords(n) {
  let s = '';
  if (n >= 100) {
    s += ONES[Math.floor(n / 100)] + ' Hundred ';
    n %= 100;
  }
  if (n >= 20) {
    s += TENS[Math.floor(n / 10)] + ' ';
    n %= 10;
  }
  if (n > 0) s += ONES[n] + ' ';
  return s.trim();
}

function integerToWords(num) {
  if (num === 0) return 'Zero';
  const crore = Math.floor(num / 10000000); num %= 10000000;
  const lakh = Math.floor(num / 100000); num %= 100000;
  const thousand = Math.floor(num / 1000); num %= 1000;
  const rest = num;

  const parts = [];
  if (crore) parts.push(threeDigitsToWords(crore) + ' Crore');
  if (lakh) parts.push(threeDigitsToWords(lakh) + ' Lakh');
  if (thousand) parts.push(threeDigitsToWords(thousand) + ' Thousand');
  if (rest) parts.push(threeDigitsToWords(rest));
  return parts.join(' ');
}

function amountToWords(amount) {
  const num = Math.round((Number(amount) || 0) * 100) / 100;
  const rupees = Math.floor(num);
  const paise = Math.round((num - rupees) * 100);
  let words = integerToWords(rupees) + ' Rupees';
  if (paise > 0) words += ' and ' + integerToWords(paise) + ' Paise';
  return words + ' Only';
}

if (typeof module !== 'undefined') module.exports = { amountToWords };
