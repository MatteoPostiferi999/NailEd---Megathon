export const STRIPE_CURRENCY = "eur";

export const STRIPE_CREDIT_PACKAGES = {
  single: {
    id: "single",
    credits: 1,
    amountCents: 100,
    productName: "1 Nailed credit",
    productDescription: "1 nail preview credit",
  },
  five: {
    id: "five",
    credits: 5,
    amountCents: 300,
    productName: "5 Nailed credits",
    productDescription: "5 nail preview credits",
  },
} as const;

export type StripeCreditPackageId = keyof typeof STRIPE_CREDIT_PACKAGES;
export type StripeCreditPackage = (typeof STRIPE_CREDIT_PACKAGES)[StripeCreditPackageId];

export function getStripeCreditPackage(packageId: string): StripeCreditPackage | null {
  if (Object.prototype.hasOwnProperty.call(STRIPE_CREDIT_PACKAGES, packageId)) {
    return STRIPE_CREDIT_PACKAGES[packageId as StripeCreditPackageId];
  }

  return null;
}
