import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // Produit un serveur Node.js autonome dans .next/standalone,
  // avec uniquement les dépendances réellement utilisées.
  // Indispensable pour une image Docker légère (voir Dockerfile).
  output: "standalone",
};

export default nextConfig;
