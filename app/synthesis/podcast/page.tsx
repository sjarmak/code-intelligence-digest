/**
 * Podcast synthesis page
 */

import { SynthesisPage } from "@/src/components/synthesis/synthesis-page";

export const metadata = {
  title: "Podcast Generator | Code Intelligence Digest",
  description: "Generate podcast episodes from selected content categories",
};

export default function PodcastPage() {
  return (
    <div className="container py-8">
      <SynthesisPage type="podcast" />
    </div>
  );
}
