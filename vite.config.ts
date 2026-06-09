import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `base` must match your GitHub repo name for Pages project sites.
export default defineConfig({
  plugins: [react()],
  base: "/campaign-tracker/",
});
