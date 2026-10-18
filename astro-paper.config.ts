import { defineAstroPaperConfig } from "./src/types/config";

export default defineAstroPaperConfig({
  site: {
    url: "https://blog.teje.sh/",
    title: "Tejesh Reddy",
    description:
      "Notes on agent safety, computer use, and the systems underneath.",
    author: "Tejesh Reddy",
    profile: "https://teje.sh",
    ogImage: "default-og.jpg",
    lang: "en",
    timezone: "America/New_York",
    dir: "ltr",
  },
  posts: {
    perPage: 6,
    perIndex: 4,
    scheduledPostMargin: 15 * 60 * 1000,
  },
  features: {
    lightAndDarkMode: true,
    dynamicOgImage: true,
    showArchives: true,
    showBackButton: true,
    editPost: { enabled: false },
    search: "pagefind",
  },
  socials: [
    { name: "github", url: "https://github.com/Moquent" },
    { name: "linkedin", url: "https://www.linkedin.com/in/tejeshreddyg/" },
    { name: "mail", url: "mailto:tejeshreddy907@gmail.com" },
  ],
  shareLinks: [
    { name: "x", url: "https://x.com/intent/post?url=" },
    { name: "mail", url: "mailto:?subject=See%20this%20post&body=" },
  ],
});
