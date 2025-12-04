'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">Error</h1>
        <p className="text-gray-400 mb-8">{error.message}</p>
        <button
          onClick={reset}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-md text-white"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
