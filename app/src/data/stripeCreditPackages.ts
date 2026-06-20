export type StripeCreditPackage = {
  id: "single" | "triple";
  credits: number;
  price: string;
  per: string;
  icon: string;
  iconBg: string;
  popular: boolean;
};

export const stripeCreditPackages: readonly StripeCreditPackage[] = [
  { id: "single", credits: 1, price: "€1", per: "1 preview", icon: "🌸", iconBg: "#FCE9EF", popular: false },
  { id: "triple", credits: 3, price: "€5", per: "3 previews", icon: "💖", iconBg: "#F3E8F7", popular: true },
];

export const defaultStripeCreditPackageId: StripeCreditPackage["id"] = "triple";
