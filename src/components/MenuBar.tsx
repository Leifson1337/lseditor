import React from 'react';
import './MenuBar.css';

const MenuBar: React.FC = () => {
  const menuItems = [
    'File',
    'Edit',
    'Selection',
    'View',
    'Go',
    'Run',
    'Terminal',
    'Help'
  ];

  return (
    <div className="menu-bar">
      {menuItems.map((item) => (
        <button key={item} className="menu-item">
          {item}
        </button>
      ))}
    </div>
  );
};

export default MenuBar; 