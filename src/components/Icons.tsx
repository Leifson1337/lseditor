import React from 'react';

// FolderIcon renders a folder SVG icon
export const FolderIcon: React.FC = () => (
  // The SVG element defines the folder icon with a width and height of 16 pixels
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    // The path element defines the shape of the folder icon using a series of coordinates
    <path d="M2 4C2 3.44772 2.44772 3 3 3H6.58579C6.851 3 7.10536 3.10536 7.29289 3.29289L8.70711 4.70711C8.89464 4.89464 9.149 5 9.41421 5H13C13.5523 5 14 5.44772 14 6V12C14 12.5523 13.5523 13 13 13H3C2.44772 13 2 12.5523 2 12V4Z" 
      // The stroke attribute sets the color of the icon to the current color
      stroke="currentColor" 
      // The strokeWidth attribute sets the width of the icon's stroke to 1.5 pixels
      strokeWidth="1.5" 
      // The strokeLinecap attribute sets the shape of the icon's stroke ends to round
      strokeLinecap="round" 
      // The strokeLinejoin attribute sets the shape of the icon's stroke joins to round
      strokeLinejoin="round"/>
  </svg>
);

// FileIcon renders a file SVG icon
export const FileIcon: React.FC = () => (
  // The SVG element defines the file icon with a width and height of 16 pixels
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    // The first path element defines the shape of the file icon using a series of coordinates
    <path d="M3 3C3 2.44772 3.44772 2 4 2H8.58579C8.851 2 9.10536 2.10536 9.29289 2.29289L13.7071 6.70711C13.8946 6.89464 14 7.149 14 7.41421V13C14 13.5523 13.5523 14 13 14H4C3.44772 14 3 13.5523 3 13V3Z" 
      // The stroke attribute sets the color of the icon to the current color
      stroke="currentColor" 
      // The strokeWidth attribute sets the width of the icon's stroke to 1.5 pixels
      strokeWidth="1.5" 
      // The strokeLinecap attribute sets the shape of the icon's stroke ends to round
      strokeLinecap="round" 
      // The strokeLinejoin attribute sets the shape of the icon's stroke joins to round
      strokeLinejoin="round"/>
    // The second path element defines the shape of the file icon's tab using a series of coordinates
    <path d="M8 2V6H12" 
      // The stroke attribute sets the color of the icon to the current color
      stroke="currentColor" 
      // The strokeWidth attribute sets the width of the icon's stroke to 1.5 pixels
      strokeWidth="1.5" 
      // The strokeLinecap attribute sets the shape of the icon's stroke ends to round
      strokeLinecap="round" 
      // The strokeLinejoin attribute sets the shape of the icon's stroke joins to round
      strokeLinejoin="round"/>
  </svg>
);

// ChevronRightIcon renders a right-pointing chevron SVG icon
export const ChevronRightIcon: React.FC = () => (
  // The SVG element defines the chevron icon with a width and height of 16 pixels
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    // The path element defines the shape of the chevron icon using a series of coordinates
    <path d="M6 4L10 8L6 12" 
      // The stroke attribute sets the color of the icon to the current color
      stroke="currentColor" 
      // The strokeWidth attribute sets the width of the icon's stroke to 1.5 pixels
      strokeWidth="1.5" 
      // The strokeLinecap attribute sets the shape of the icon's stroke ends to round
      strokeLinecap="round" 
      // The strokeLinejoin attribute sets the shape of the icon's stroke joins to round
      strokeLinejoin="round"/>
  </svg>
);

// ChevronDownIcon renders a downward-pointing chevron SVG icon
export const ChevronDownIcon: React.FC = () => (
  // The SVG element defines the chevron icon with a width and height of 16 pixels
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    // The path element defines the shape of the chevron icon using a series of coordinates
    <path d="M4 6L8 10L12 6" 
      // The stroke attribute sets the color of the icon to the current color
      stroke="currentColor" 
      // The strokeWidth attribute sets the width of the icon's stroke to 1.5 pixels
      strokeWidth="1.5" 
      // The strokeLinecap attribute sets the shape of the icon's stroke ends to round
      strokeLinecap="round" 
      // The strokeLinejoin attribute sets the shape of the icon's stroke joins to round
      strokeLinejoin="round"/>
  </svg>
);

// CloseIcon renders a close (X) SVG icon
export const CloseIcon: React.FC = () => (
  // The SVG element defines the close icon with a width and height of 16 pixels
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    // The path element defines the shape of the close icon using a series of coordinates
    <path d="M12 4L4 12M4 4L12 12" 
      // The stroke attribute sets the color of the icon to the current color
      stroke="currentColor" 
      // The strokeWidth attribute sets the width of the icon's stroke to 1.5 pixels
      strokeWidth="1.5" 
      // The strokeLinecap attribute sets the shape of the icon's stroke ends to round
      strokeLinecap="round" 
      // The strokeLinejoin attribute sets the shape of the icon's stroke joins to round
      strokeLinejoin="round"/>
  </svg>
);