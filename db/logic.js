function computeTotals({ items, discount = 0, sellerState, customerState, roundOffOverride = null }) {
  let subtotal = 0;
  let taxTotal = 0;
  for (const item of items) {
    const amount = round2(item.qty * item.rate);
    subtotal += amount;
    taxTotal += amount * (item.gst_percent / 100);
  }
  subtotal = round2(subtotal);
  const taxableAfterDiscount = Math.max(0, subtotal - (discount || 0));
  const effectiveTax = subtotal > 0 ? taxTotal * (taxableAfterDiscount / subtotal) : 0;

  const sameState = (sellerState || '').trim().toLowerCase() === (customerState || '').trim().toLowerCase();
  let cgst = 0, sgst = 0, igst = 0;
  if (sameState) {
    cgst = round2(effectiveTax / 2);
    sgst = round2(effectiveTax / 2);
  } else {
    igst = round2(effectiveTax);
  }

  const preRoundTotal = taxableAfterDiscount + cgst + sgst + igst;
  const roundedTotal = Math.round(preRoundTotal);
  const roundOff = roundOffOverride !== null ? roundOffOverride : round2(roundedTotal - preRoundTotal);
  const total = round2(preRoundTotal + roundOff);

  return { subtotal, discount: round2(discount || 0), cgst, sgst, igst, roundOff, total };
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

module.exports = { computeTotals, round2 };
