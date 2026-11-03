import React from 'react';
import { Link } from 'react-router-dom';
import { AboutPage } from '../components/AboutPage';

// The public /about address (so a visitor, a parent or a payment provider's reviewer can read it without signing in). The same page
// also sits in the signed-in app's menu.
export default function AboutPublic() {
  return (
    <div className="min-h-screen bg-[#FAF7F2] px-4 py-12">
      <div className="max-w-3xl mx-auto mb-4">
        <Link to="/" className="text-sm font-bold text-[#15803D] hover:underline">
          Back to Tutorlage
        </Link>
      </div>
      <AboutPage />
    </div>
  );
}
