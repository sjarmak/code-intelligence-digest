/**
 * Newsletter synthesis page
 */

import { SynthesisPage } from "@/src/components/synthesis/synthesis-page";

export const metadata = {
  title: "Newsletter Generator | Code Intelligence Digest",
  description: "Generate curated newsletters from selected content categories",
};

export default function NewsletterPage() {
  return (
    <div className="container py-8">
      <SynthesisPage type="newsletter" />
    </div>
  );
}
