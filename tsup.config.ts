import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		lib: "src/lib.ts",
		internal: "src/internal.ts",
		babel: "src/babel/index.ts",
	},
	splitting: false,
	sourcemap: true,
	clean: true,
	minify: true,
	format: ["esm", "cjs"],
});
