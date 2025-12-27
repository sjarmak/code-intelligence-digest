'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  List,
  MessageSquare,
  Tag,
  Bookmark,
  ZoomIn,
  ZoomOut,
  ExternalLink,
  Loader2,
  Plus,
  Trash2,
  Edit3,
  Check,
  Sparkles,
} from 'lucide-react';

// Types
interface PaperSection {
  id: string;
  title: string;
  level: number;
}

interface PaperFigure {
  id: string;
  src: string;
  caption: string;
  alt?: string;
}

interface PaperAnnotation {
  id: string;
  bibcode: string;
  type: 'note' | 'highlight';
  content: string;
  note?: string | null;
  startOffset?: number | null;
  endOffset?: number | null;
  sectionId?: string | null;
  createdAt: number;
  updatedAt: number;
}

interface PaperTag {
  id: string;
  name: string;
  color?: string | null;
  createdAt: number;
}

interface PaperContent {
  source: 'ar5iv' | 'arxiv' | 'ads' | 'abstract';
  html: string;
  title?: string;
  authors?: string[];
  abstract?: string;
  sections?: PaperSection[];
  figures?: PaperFigure[];
  tableOfContents?: PaperSection[];
  bibcode: string;
  arxivId?: string | null;
  adsUrl?: string;
  arxivUrl?: string | null;
}

interface PaperReaderModalProps {
  bibcode: string;
  title?: string;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  hasPrevious?: boolean;
  hasNext?: boolean;
}

type SidebarPanel = 'toc' | 'annotations' | 'tags' | null;

export function PaperReaderModal({
  bibcode,
  title: initialTitle,
  onClose,
  onPrevious,
  onNext,
  hasPrevious = false,
  hasNext = false,
}: PaperReaderModalProps) {
  // Content state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<PaperContent | null>(null);

  // Annotations state
  const [annotations, setAnnotations] = useState<PaperAnnotation[]>([]);
  const [paperNotes, setPaperNotes] = useState<string>('');
  const [editingNote, setEditingNote] = useState(false);
  const [noteInput, setNoteInput] = useState('');

  // Tags state
  const [tags, setTags] = useState<PaperTag[]>([]);
  const [allTags, setAllTags] = useState<PaperTag[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [showTagInput, setShowTagInput] = useState(false);

  // UI state
  const [sidebarPanel, setSidebarPanel] = useState<SidebarPanel>(null);
  const [fontSize, setFontSize] = useState(18);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [structuredSummary, setStructuredSummary] = useState<{
    keyFindings: string[];
    methods: string;
    implications: string;
  } | null>(null);

  const contentRef = useRef<HTMLDivElement>(null);

  // Fetch paper content
  const fetchContent = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/papers/${encodeURIComponent(bibcode)}/content`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to fetch paper content');
      }
      const data = await response.json();
      setContent(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [bibcode]);

  // Fetch annotations
  const fetchAnnotations = useCallback(async () => {
    try {
      const response = await fetch(`/api/papers/${encodeURIComponent(bibcode)}/annotations`);
      if (response.ok) {
        const data = await response.json();
        setAnnotations(data.annotations || []);
        setPaperNotes(data.paperNotes || '');
        setNoteInput(data.paperNotes || '');
      }
    } catch (err) {
      console.error('Failed to fetch annotations:', err);
    }
  }, [bibcode]);

  // Fetch tags
  const fetchTags = useCallback(async () => {
    try {
      const [paperTagsRes, allTagsRes] = await Promise.all([
        fetch(`/api/papers/${encodeURIComponent(bibcode)}/tags`),
        fetch('/api/tags'),
      ]);

      if (paperTagsRes.ok) {
        const data = await paperTagsRes.json();
        setTags(data.tags || []);
      }

      if (allTagsRes.ok) {
        const data = await allTagsRes.json();
        setAllTags(data.tags || []);
      }
    } catch (err) {
      console.error('Failed to fetch tags:', err);
    }
  }, [bibcode]);

  // Save paper notes
  const savePaperNotes = async () => {
    try {
      await fetch(`/api/papers/${encodeURIComponent(bibcode)}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'updatePaperNotes', notes: noteInput }),
      });
      setPaperNotes(noteInput);
      setEditingNote(false);
    } catch (err) {
      console.error('Failed to save notes:', err);
    }
  };

  // Add annotation
  const addAnnotation = async (type: 'note' | 'highlight', text: string, note?: string) => {
    try {
      const response = await fetch(`/api/papers/${encodeURIComponent(bibcode)}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, content: text, note }),
      });
      if (response.ok) {
        const annotation = await response.json();
        setAnnotations((prev) => [annotation, ...prev]);
      }
    } catch (err) {
      console.error('Failed to add annotation:', err);
    }
  };

  // Delete annotation
  const deleteAnnotation = async (id: string) => {
    try {
      const response = await fetch(
        `/api/papers/${encodeURIComponent(bibcode)}/annotations?id=${id}`,
        { method: 'DELETE' }
      );
      if (response.ok) {
        setAnnotations((prev) => prev.filter((a) => a.id !== id));
      }
    } catch (err) {
      console.error('Failed to delete annotation:', err);
    }
  };

  // Add tag to paper
  const addTag = async (tagId?: string, name?: string) => {
    try {
      const response = await fetch(`/api/papers/${encodeURIComponent(bibcode)}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tagId ? { tagId } : { name }),
      });
      if (response.ok) {
        const data = await response.json();
        setTags(data.tags || []);
        // Refresh all tags in case a new one was created
        if (name) {
          fetchTags();
        }
      }
      setNewTagName('');
      setShowTagInput(false);
    } catch (err) {
      console.error('Failed to add tag:', err);
    }
  };

  // Remove tag from paper
  const removeTag = async (tagId: string) => {
    try {
      const response = await fetch(
        `/api/papers/${encodeURIComponent(bibcode)}/tags?tagId=${tagId}`,
        { method: 'DELETE' }
      );
      if (response.ok) {
        const data = await response.json();
        setTags(data.tags || []);
      }
    } catch (err) {
      console.error('Failed to remove tag:', err);
    }
  };

  // Generate structured summary
  const generateStructuredSummary = async () => {
    setGeneratingSummary(true);
    try {
      const response = await fetch(`/api/papers/${encodeURIComponent(bibcode)}/summarize`, {
        method: 'POST',
      });
      if (response.ok) {
        const data = await response.json();
        // Parse the summary into structured format
        const summary = data.summary || '';
        setStructuredSummary({
          keyFindings: [summary],
          methods: '',
          implications: '',
        });
      }
    } catch (err) {
      console.error('Failed to generate summary:', err);
    } finally {
      setGeneratingSummary(false);
    }
  };

  // Scroll to section
  const scrollToSection = (sectionId: string) => {
    const element = contentRef.current?.querySelector(`#${sectionId}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Handle text selection for highlighting
  const handleTextSelection = () => {
    const selection = window.getSelection();
    if (selection && selection.toString().trim().length > 0) {
      const text = selection.toString().trim();
      // For now, just add as a note. Could expand to show a popover
      addAnnotation('highlight', text);
      selection.removeAllRanges();
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft' && hasPrevious && onPrevious) {
        onPrevious();
      } else if (e.key === 'ArrowRight' && hasNext && onNext) {
        onNext();
      } else if (e.key === '+' || e.key === '=') {
        setFontSize((prev) => Math.min(prev + 2, 28));
      } else if (e.key === '-') {
        setFontSize((prev) => Math.max(prev - 2, 12));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, onPrevious, onNext, hasPrevious, hasNext]);

  // Fetch data on mount
  useEffect(() => {
    fetchContent();
    fetchAnnotations();
    fetchTags();
  }, [fetchContent, fetchAnnotations, fetchTags]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const title = content?.title || initialTitle || bibcode;
  const authors = content?.authors || [];

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          {/* Navigation */}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              title="Close (Esc)"
            >
              <X className="w-5 h-5" />
            </button>

            {(hasPrevious || hasNext) && (
              <div className="flex items-center gap-1 ml-2">
                <button
                  onClick={onPrevious}
                  disabled={!hasPrevious}
                  className="p-2 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Previous paper"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  onClick={onNext}
                  disabled={!hasNext}
                  className="p-2 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Next paper"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>

          {/* Title */}
          <div className="flex-1 min-w-0 text-center">
            <h1 className="font-semibold text-lg truncate">{title}</h1>
            {authors.length > 0 && (
              <p className="text-sm text-gray-500 truncate">
                {authors.slice(0, 3).join(', ')}
                {authors.length > 3 && ' et al.'}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {/* Font size */}
            <button
              onClick={() => setFontSize((prev) => Math.max(prev - 2, 12))}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              title="Decrease font size"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-sm text-gray-500 w-8 text-center">{fontSize}</span>
            <button
              onClick={() => setFontSize((prev) => Math.min(prev + 2, 28))}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              title="Increase font size"
            >
              <ZoomIn className="w-4 h-4" />
            </button>

            {/* Sidebar toggles */}
            <div className="flex items-center gap-1 ml-2 border-l pl-2">
              <button
                onClick={() => setSidebarPanel(sidebarPanel === 'toc' ? null : 'toc')}
                className={`p-2 rounded-lg transition-colors ${
                  sidebarPanel === 'toc' ? 'bg-gray-200' : 'hover:bg-gray-100'
                }`}
                title="Table of contents"
              >
                <List className="w-5 h-5" />
              </button>
              <button
                onClick={() => setSidebarPanel(sidebarPanel === 'annotations' ? null : 'annotations')}
                className={`p-2 rounded-lg transition-colors relative ${
                  sidebarPanel === 'annotations' ? 'bg-gray-200' : 'hover:bg-gray-100'
                }`}
                title="Annotations"
              >
                <MessageSquare className="w-5 h-5" />
                {annotations.length > 0 && (
                  <span className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs w-4 h-4 rounded-full flex items-center justify-center">
                    {annotations.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setSidebarPanel(sidebarPanel === 'tags' ? null : 'tags')}
                className={`p-2 rounded-lg transition-colors relative ${
                  sidebarPanel === 'tags' ? 'bg-gray-200' : 'hover:bg-gray-100'
                }`}
                title="Tags"
              >
                <Tag className="w-5 h-5" />
                {tags.length > 0 && (
                  <span className="absolute -top-1 -right-1 bg-green-500 text-white text-xs w-4 h-4 rounded-full flex items-center justify-center">
                    {tags.length}
                  </span>
                )}
              </button>
            </div>

            {/* External links */}
            {content?.arxivUrl && (
              <a
                href={content.arxivUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-red-600"
                title="View on arXiv"
              >
                <ExternalLink className="w-5 h-5" />
              </a>
            )}
          </div>
        </div>

        {/* Tags row */}
        {tags.length > 0 && (
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {tags.map((tag) => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
                style={{
                  backgroundColor: tag.color ? `${tag.color}20` : '#e5e7eb',
                  color: tag.color || '#374151',
                }}
              >
                {tag.name}
                <button
                  onClick={() => removeTag(tag.id)}
                  className="hover:text-red-500 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </header>

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Content */}
        <main
          className="flex-1 overflow-y-auto"
          onMouseUp={handleTextSelection}
        >
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full p-8">
              <div className="text-center max-w-md">
                <p className="text-red-600 font-medium mb-2">Failed to load paper</p>
                <p className="text-gray-500 text-sm">{error}</p>
                <button
                  onClick={fetchContent}
                  className="mt-4 px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Try again
                </button>
              </div>
            </div>
          ) : content ? (
            <div
              ref={contentRef}
              className="max-w-3xl mx-auto px-6 py-8"
              style={{ fontSize: `${fontSize}px`, lineHeight: 1.7 }}
            >
              {/* Source indicator */}
              <div className="mb-6 text-sm text-gray-400">
                Source: {content.source === 'ar5iv' ? 'ar5iv.org' : content.source === 'arxiv' ? 'arXiv HTML' : content.source === 'ads' ? 'ADS' : 'Abstract only'}
              </div>

              {/* Structured Summary */}
              {structuredSummary && (
                <div className="mb-8 p-4 bg-purple-50 rounded-lg border border-purple-200">
                  <h3 className="font-semibold text-purple-900 mb-2 flex items-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    AI Summary
                  </h3>
                  <p className="text-purple-900">{structuredSummary.keyFindings[0]}</p>
                </div>
              )}

              {/* Generate summary button */}
              {!structuredSummary && (
                <button
                  onClick={generateStructuredSummary}
                  disabled={generatingSummary}
                  className="mb-8 flex items-center gap-2 px-4 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition-colors disabled:opacity-50"
                >
                  {generatingSummary ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Generating summary...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Generate AI Summary
                    </>
                  )}
                </button>
              )}

              {/* Paper content */}
              <article
                className="prose prose-lg max-w-none paper-content"
                dangerouslySetInnerHTML={{ __html: content.html }}
              />
            </div>
          ) : null}
        </main>

        {/* Sidebar */}
        {sidebarPanel && (
          <aside className="w-80 flex-shrink-0 border-l border-gray-200 bg-gray-50 overflow-y-auto">
            <div className="p-4">
              {/* Table of Contents */}
              {sidebarPanel === 'toc' && (
                <div>
                  <h2 className="font-semibold mb-4">Table of Contents</h2>
                  {content?.tableOfContents && content.tableOfContents.length > 0 ? (
                    <nav className="space-y-2">
                      {content.tableOfContents.map((section) => (
                        <button
                          key={section.id}
                          onClick={() => scrollToSection(section.id)}
                          className="block w-full text-left text-sm text-gray-600 hover:text-gray-900 transition-colors"
                          style={{ paddingLeft: `${(section.level - 1) * 12}px` }}
                        >
                          {section.title}
                        </button>
                      ))}
                    </nav>
                  ) : (
                    <p className="text-sm text-gray-500">No sections available</p>
                  )}
                </div>
              )}

              {/* Annotations */}
              {sidebarPanel === 'annotations' && (
                <div>
                  <h2 className="font-semibold mb-4">Notes & Highlights</h2>

                  {/* Paper-level notes */}
                  <div className="mb-6">
                    <h3 className="text-sm font-medium text-gray-500 mb-2">Paper Notes</h3>
                    {editingNote ? (
                      <div className="space-y-2">
                        <textarea
                          value={noteInput}
                          onChange={(e) => setNoteInput(e.target.value)}
                          className="w-full p-3 border border-gray-300 rounded-lg text-sm resize-none"
                          rows={4}
                          placeholder="Add your notes about this paper..."
                          autoFocus
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => {
                              setNoteInput(paperNotes);
                              setEditingNote(false);
                            }}
                            className="px-3 py-1 text-sm text-gray-600 hover:text-gray-900"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={savePaperNotes}
                            className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors flex items-center gap-1"
                          >
                            <Check className="w-3 h-3" />
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        onClick={() => setEditingNote(true)}
                        className="p-3 border border-gray-200 rounded-lg cursor-pointer hover:border-gray-300 transition-colors min-h-[80px]"
                      >
                        {paperNotes ? (
                          <p className="text-sm text-gray-700 whitespace-pre-wrap">{paperNotes}</p>
                        ) : (
                          <p className="text-sm text-gray-400 flex items-center gap-2">
                            <Edit3 className="w-4 h-4" />
                            Click to add notes...
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Annotations list */}
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-2">
                      Highlights ({annotations.length})
                    </h3>
                    {annotations.length > 0 ? (
                      <div className="space-y-3">
                        {annotations.map((annotation) => (
                          <div
                            key={annotation.id}
                            className="p-3 bg-white rounded-lg border border-gray-200 group"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1">
                                {annotation.type === 'highlight' && (
                                  <p className="text-sm text-gray-900 bg-yellow-100 px-1 -mx-1">
                                    "{annotation.content}"
                                  </p>
                                )}
                                {annotation.note && (
                                  <p className="text-sm text-gray-600 mt-1">{annotation.note}</p>
                                )}
                                {annotation.type === 'note' && (
                                  <p className="text-sm text-gray-700">{annotation.content}</p>
                                )}
                              </div>
                              <button
                                onClick={() => deleteAnnotation(annotation.id)}
                                className="opacity-0 group-hover:opacity-100 p-1 text-red-500 hover:text-red-700 transition-all"
                                title="Delete"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                            <p className="text-xs text-gray-400 mt-2">
                              {new Date(annotation.createdAt * 1000).toLocaleDateString()}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500">
                        Select text in the paper to add highlights
                      </p>
                    )}
                  </div>

                  {/* Quick add note */}
                  <div className="mt-6">
                    <button
                      onClick={() => {
                        const note = window.prompt('Add a note:');
                        if (note) addAnnotation('note', note);
                      }}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors text-sm"
                    >
                      <Plus className="w-4 h-4" />
                      Add Note
                    </button>
                  </div>
                </div>
              )}

              {/* Tags */}
              {sidebarPanel === 'tags' && (
                <div>
                  <h2 className="font-semibold mb-4">Tags</h2>

                  {/* Current tags */}
                  <div className="flex flex-wrap gap-2 mb-4">
                    {tags.map((tag) => (
                      <span
                        key={tag.id}
                        className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm"
                        style={{
                          backgroundColor: tag.color ? `${tag.color}20` : '#e5e7eb',
                          color: tag.color || '#374151',
                        }}
                      >
                        {tag.name}
                        <button
                          onClick={() => removeTag(tag.id)}
                          className="hover:text-red-500 transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                    {tags.length === 0 && (
                      <p className="text-sm text-gray-500">No tags yet</p>
                    )}
                  </div>

                  {/* Add tag */}
                  {showTagInput ? (
                    <div className="flex items-center gap-2 mb-4">
                      <input
                        type="text"
                        value={newTagName}
                        onChange={(e) => setNewTagName(e.target.value)}
                        placeholder="New tag name"
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && newTagName.trim()) {
                            addTag(undefined, newTagName.trim());
                          } else if (e.key === 'Escape') {
                            setShowTagInput(false);
                            setNewTagName('');
                          }
                        }}
                      />
                      <button
                        onClick={() => {
                          if (newTagName.trim()) {
                            addTag(undefined, newTagName.trim());
                          }
                        }}
                        className="px-3 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowTagInput(true)}
                      className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 transition-colors mb-4"
                    >
                      <Plus className="w-4 h-4" />
                      Add new tag
                    </button>
                  )}

                  {/* Existing tags to add */}
                  {allTags.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-500 mb-2">Add existing tag</h3>
                      <div className="flex flex-wrap gap-2">
                        {allTags
                          .filter((t) => !tags.some((pt) => pt.id === t.id))
                          .map((tag) => (
                            <button
                              key={tag.id}
                              onClick={() => addTag(tag.id)}
                              className="px-3 py-1 rounded-full text-sm border border-gray-300 hover:border-gray-400 transition-colors"
                              style={{
                                borderColor: tag.color || undefined,
                                color: tag.color || '#374151',
                              }}
                            >
                              + {tag.name}
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Styles for paper content */}
      <style jsx global>{`
        .paper-content h1,
        .paper-content h2,
        .paper-content h3,
        .paper-content h4 {
          font-weight: 600;
          margin-top: 2em;
          margin-bottom: 0.5em;
        }

        .paper-content h1 {
          font-size: 1.5em;
        }

        .paper-content h2 {
          font-size: 1.3em;
        }

        .paper-content h3 {
          font-size: 1.15em;
        }

        .paper-content p {
          margin-bottom: 1em;
        }

        .paper-content figure {
          margin: 2em 0;
          text-align: center;
        }

        .paper-content figure img {
          max-width: 100%;
          height: auto;
        }

        .paper-content figcaption {
          font-size: 0.9em;
          color: #666;
          margin-top: 0.5em;
        }

        .paper-content table {
          width: 100%;
          border-collapse: collapse;
          margin: 1em 0;
        }

        .paper-content th,
        .paper-content td {
          border: 1px solid #ddd;
          padding: 0.5em;
          text-align: left;
        }

        .paper-content th {
          background-color: #f5f5f5;
        }

        .paper-content a {
          color: #2563eb;
          text-decoration: underline;
        }

        .paper-content a:hover {
          color: #1d4ed8;
        }

        .paper-content .ltx_Math,
        .paper-content .mjx-chtml {
          overflow-x: auto;
        }

        /* Mobile optimizations */
        @media (max-width: 768px) {
          .paper-content {
            font-size: 16px !important;
          }

          .paper-content figure {
            margin: 1em -1rem;
          }
        }
      `}</style>
    </div>
  );
}
