'use client';

import React from 'react';


const Footer = () => {
  return (
    <footer className="bg-gray-800 text-white py-8">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row justify-between items-center">
          <p className="text-sm mb-4 md:mb-0">
            © {new Date().getFullYear()} Bent's Woodworking Assistant. All rights reserved.
          </p>
          <nav>
            <ul className="flex space-x-4">
              <li>
                <div 
                  className="text-sm hover:text-gray-300 transition-colors"
                >
                  Terms of Service
                </div>
              </li>
              <li>
                <div 
                  className="text-sm hover:text-gray-300 transition-colors"
                >
                  Privacy
                </div>
              </li>
            </ul>
          </nav>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
