import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-white text-black flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">404</h1>
        <p className="text-gray-600 mb-8">Page not found</p>
        <Link href="/" className="text-black hover:text-gray-700">
          Return home
        </Link>
      </div>
    </div>
  );
}
