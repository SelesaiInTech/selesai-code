import { capabilities, categories } from "./capabilities.ts";

type SidebarConfig = Array<{
  label: string;
  translations?: Record<string, string>;
  link?: string;
  collapsed?: boolean;
  items?: SidebarConfig;
}>;

const bundledGuides = categories.map((category) => ({
  label: category.en,
  translations: { id: category.indonesian },
  collapsed: true,
  items: capabilities
    .filter((capability) => capability.category === category.id && capability.distribution === "bundled")
    .map((capability) => ({
      label: capability.en.displayName,
      translations: { id: capability.id.displayName },
      link: `/${capability.guideRoute}/`,
    })),
}));

const optionalCapabilities = capabilities.filter((c) => c.distribution === "optional");
const optionalGroup = optionalCapabilities.length
  ? {
      label: "Optional extensions",
      translations: { id: "Ekstensi opsional" },
      collapsed: true,
      items: optionalCapabilities.map((capability) => ({
        label: capability.en.displayName,
        translations: { id: capability.id.displayName },
        link: `/${capability.guideRoute}/`,
      })),
    }
  : undefined;

export const navigation: SidebarConfig = [
  { label: "Overview", translations: { id: "Ringkasan" }, link: "/" },
  { label: "Get started", translations: { id: "Mulai" }, link: "/get-started/" },
  { label: "Why Selesai", translations: { id: "Mengapa Selesai" }, link: "/why-selesai/" },
  { label: "Capabilities", translations: { id: "Kemampuan" }, link: "/capabilities/" },
  {
    label: "Customization",
    translations: { id: "Kustomisasi" },
    link: "/customization/",
  },
  {
    label: "Guides",
    translations: { id: "Panduan" },
    collapsed: false,
    items: optionalGroup ? [...bundledGuides, optionalGroup] : bundledGuides,
  },
  { label: "Evidence", translations: { id: "Bukti" }, link: "/evidence/" },
  { label: "Changelog", link: "/changelog/" },
  { label: "Accessibility", translations: { id: "Aksesibilitas" }, link: "/accessibility/" },
];
