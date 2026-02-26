'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { LibrariesView } from '@/src/components/libraries/libraries-view';
import { ResourceLibrariesView } from '@/src/components/libraries/resource-libraries-view';
import { PapersQA } from '@/src/components/libraries/papers-qa';

export const dynamic = 'force-dynamic';

export default function LibrariesPage() {
   const resourcesQARef = useRef<{
     addPaper: (paper: { bibcode: string; title?: string }) => void;
     addItem: (item: { id: string; title?: string }) => void;
     addNewsletter: (newsletter: { id: string; title: string }) => void;
     addPodcast: (podcast: { id: string; title: string }) => void;
     setSelectedLibrary: (library: { id: string; name: string; numPapers?: number; numItems?: number }) => void;
   } | null>(null);

   const handleAddPaperToQA = (paper: { bibcode: string; title?: string }) => {
     resourcesQARef.current?.addPaper(paper);
   };

   const handleAddItemToQA = (item: { id: string; title?: string }) => {
     resourcesQARef.current?.addItem(item);
   };

   const handleAddNewsletterToQA = (newsletter: { id: string; title: string }) => {
     resourcesQARef.current?.addNewsletter(newsletter);
   };

   const handleAddPodcastToQA = (podcast: { id: string; title: string }) => {
     resourcesQARef.current?.addPodcast(podcast);
   };

   const handleSelectLibrary = (library: { id: string; name: string; numPapers?: number; numItems?: number }) => {
     resourcesQARef.current?.setSelectedLibrary(library);
   };

   const handleSelectResourceLibrary = (library: { id: string; name: string; numItems: number }) => {
     resourcesQARef.current?.setSelectedLibrary({
       id: library.id,
       name: library.name,
       numItems: library.numItems,
     });
   };

   return (
     <div className="min-h-screen bg-white text-black">
       {/* Header */}
       <header className="border-b border-surface-border sticky top-0 z-10 bg-surface">
         <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="space-y-4">
            {/* Back Button */}
            <div>
              <Link
                href="/"
                className="inline-block px-4 py-2 rounded-md text-sm font-medium transition-colors bg-surface border border-surface-border text-muted hover:text-foreground"
              >
                ← Back to Home
              </Link>
            </div>
            <div>
              <h1 className="text-3xl font-bold">Libraries</h1>
              <p className="text-muted mt-2">
                Curated content from research and resource libraries with AI-powered analysis
              </p>
            </div>
          </div>
         </div>
       </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Q&A Panel */}
        <PapersQA ref={resourcesQARef} />

        {/* Research Libraries Section */}
        <div>
          <h2 className="text-2xl font-bold mb-4">Research Libraries</h2>
          <LibrariesView onAddPaperToQA={handleAddPaperToQA} onSelectLibraryForQA={handleSelectLibrary} />
        </div>

        {/* Resource Libraries Section */}
        <div>
          <h2 className="text-2xl font-bold mb-4">Resource Libraries</h2>
          <ResourceLibrariesView
            onAddItemToQA={handleAddItemToQA}
            onAddNewsletterToQA={handleAddNewsletterToQA}
            onAddPodcastToQA={handleAddPodcastToQA}
            onSelectLibraryForQA={handleSelectResourceLibrary}
          />
        </div>
      </main>
    </div>
  );
}
