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
    <div className="min-h-screen bg-white text-black">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <SynthesisPage type="newsletter" />
      </div>
    </div>
  );
}
