/**
 * Synthesis hub - redirects to podcast generator
 */

import { redirect } from "next/navigation";

export const metadata = {
  title: "Content Synthesis | Code Intelligence Digest",
  description: "Generate newsletters and podcasts from curated content",
};

export default function SynthesisHub() {
  redirect("/synthesis/podcast");
}
