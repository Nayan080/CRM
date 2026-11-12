/** Digits only (for matching). "+61 412 345 678" → "61412345678". */
export function phoneDigits(phone: string | null | undefined): string | null {
  const digits = phone?.replace(/\D/g, '') ?? '';
  return digits.length >= 6 ? digits : null;
}

/**
 * The last 9 digits identify a number regardless of country code or leading zero
 * ("0412 345 678" and "+61 412 345 678" both end in 412345678).
 */
export function phoneMatchKey(phone: string | null | undefined): string | null {
  const digits = phoneDigits(phone);
  return digits ? digits.slice(-9) : null;
}
