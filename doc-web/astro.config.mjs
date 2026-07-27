import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import { navigation } from "./src/data/navigation.ts";

const site = process.env.CI
  ? `https://${process.env.GITHUB_PAGES_HOST || "selesaiintech.github.io"}`
  : "http://localhost:4321";
const base = process.env.CI ? `/${process.env.GITHUB_REPOSITORY?.split("/")[1] || "selesai-docs"}/` : "/";

export default defineConfig({
  site,
  base,
  integrations: [
    starlight({
      title: "Selesai Docs",
      logo: {
        src: "./public/favicon.svg",
        replacesTitle: false,
      },
      tagline: "Extension-first Pi coding agent, ready out of the box.",
      defaultLocale: "root",
      locales: {
        root: {
          label: "English",
          lang: "en",
        },
        id: {
          label: "Bahasa Indonesia",
          lang: "id",
        },
      },
      sidebar: navigation,
      customCss: ["./src/styles/custom.css"],
      social: {
        github: "https://github.com/SelesaiInTech/selesai-code",
      },
      editLink: {
        baseUrl: "https://github.com/SelesaiInTech/selesai-code/edit/main/doc-web/",
      },
      pagefind: true,
      head: [
        {
          tag: "meta",
          attrs: { name: "description", content: "Selesai documentation — bundled extensions, workflows, subagents, web research, and comparison with the original Pi coding agent." },
        },
      ],
      expressiveCode: {
        themes: ["github-dark", "github-light"],
      },
    }),
  ],
  output: "static",
  server: {
    port: 4321,
  },
  vite: {
    resolve: {
      alias: {
        "~": new URL("./src", import.meta.url).pathname,
      },
    },
  },
});
