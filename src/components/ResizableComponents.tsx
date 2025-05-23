import React, { useRef } from 'react';

// ResizableSidebar provides a sidebar that can be resized horizontally by dragging
export const ResizableSidebar: React.FC<{children: React.ReactNode, initialWidth?:number, minWidth?:number, maxWidth?:number}> = ({children, initialWidth=260, minWidth=160, maxWidth=480}) => {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(initialWidth);
  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!sidebarRef.current || !dragRef.current) return;
      // Calculate new sidebar width based on mouse X position
      let newWidth = e.clientX - sidebarRef.current.getBoundingClientRect().left;
      if (minWidth) newWidth = Math.max(minWidth, newWidth);
      if (maxWidth) newWidth = Math.min(maxWidth, newWidth);
      setWidth(newWidth);
    };
    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    if (dragRef.current) {
      dragRef.current.onmousedown = () => {
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
      };
    }
    return () => {
      if (dragRef.current) dragRef.current.onmousedown = null;
    };
  }, [minWidth, maxWidth]);
  return (
    <div ref={sidebarRef} style={{width, minWidth, maxWidth, height:'100%', position:'relative', display:'flex'}}>
      {children}
      {/* Drag handle for resizing the sidebar */}
      <div ref={dragRef} style={{width:6, cursor:'col-resize', position:'absolute', right:0, top:0, bottom:0, zIndex:10, background:'#2224', borderRadius:3}} />
    </div>
  );
};

// ResizableAIPanel provides a right-side panel that can be resized horizontally by dragging
export const ResizableAIPanel: React.FC<{children: React.ReactNode, initialWidth?:number, minWidth?:number, maxWidth?:number}> = ({children, initialWidth=340, minWidth=260, maxWidth=600}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(initialWidth);
  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!panelRef.current || !dragRef.current) return;
      // Calculate new panel width based on mouse X position (from the right)
      let newWidth = panelRef.current.getBoundingClientRect().right - e.clientX;
      if (minWidth) newWidth = Math.max(minWidth, newWidth);
      if (maxWidth) newWidth = Math.min(maxWidth, newWidth);
      setWidth(newWidth);
    };
    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    if (dragRef.current) {
      dragRef.current.onmousedown = () => {
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
      };
    }
    return () => {
      if (dragRef.current) dragRef.current.onmousedown = null;
    };
  }, [minWidth, maxWidth]);
  return (
    <div ref={panelRef} style={{width, minWidth, maxWidth, height:'100%', position:'relative', display:'flex'}}>
      {/* Drag handle for resizing the AI panel */}
      <div ref={dragRef} style={{width:6, cursor:'col-resize', position:'absolute', left:0, top:0, bottom:0, zIndex:10, background:'#2224', borderRadius:3}} />
      {children}
    </div>
  );
};

// ResizableMainArea provides a flexible main area that can be extended for vertical resizing if needed
export const ResizableMainArea: React.FC<{children: React.ReactNode}> = ({children}) => {
  // Optional: For future use, could be made vertically resizable
  return <div style={{flex:1, height:'100%', minWidth:0, minHeight:0, position:'relative', display:'flex', flexDirection:'column'}}>{children}</div>;
};
