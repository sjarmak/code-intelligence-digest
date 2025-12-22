'use client';

interface DigestThemesProps {
  themes: string[];
}

export default function DigestThemes({ themes }: DigestThemesProps) {
  return (
    <div className="bg-surface border border-surface-border rounded-lg p-6">
      <h2 className="text-xl font-bold text-foreground mb-4">Key Themes</h2>

      <div className="flex flex-wrap gap-3">
        {themes.map((theme, idx) => (
          <div
            key={theme}
            className="px-3 py-2 bg-gray-100 border border-gray-400/50 rounded-full text-sm text-gray-600 hover:bg-blue-900/50 transition-colors"
          >
            <span className="font-medium">{theme}</span>
            <span className="text-gray-700/70 ml-2">{`#${idx + 1}`}.</span>
          </div>
        ))}
      </div>

      <p className="text-sm text-muted mt-4">
        These themes represent the most discussed topics and trends in this week&apos;s content.
      </p>
    </div>
  );
}
