// components/Whiteboard.tsx
'use client';
import React, {useRef, useEffect, useState} from 'react';
import {io, Socket} from 'socket.io-client';
import {createTheme, ThemeProvider} from '@mui/material/styles';
import {
    AppBar,
    Toolbar,
    IconButton,
    Slider,
    Tooltip,
    Menu,
    MenuItem,
    Drawer,
    List,
    ListItem,
    ListItemText,
    Divider,
    Select,
    InputLabel,
    FormControl,
    Button,
    Box
} from '@mui/material';
import {
    Brush as BrushIcon,
    PanTool as PanToolIcon,
    Save as SaveIcon,
    Restore as RestoreIcon,
    Delete as DeleteIcon,
    Undo as UndoIcon,
    Redo as RedoIcon,
    Place as PlaceIcon,
    ZoomIn as ZoomInIcon,
    ZoomOut as ZoomOutIcon,
    MoreVert as MoreVertIcon
} from '@mui/icons-material';
import {SketchPicker} from 'react-color';
type Point = {
    x: number;
    y: number
};
type Path = {
    points: Point[];
    color: string;
    size: number;
};
type Mode = 'none' | 'drawing' | 'panning' | 'placingWaypoint' | 'zooming';
type Waypoint = {
    id: number;
    name: string;
    position: Point;
};
let socket: Socket;
const theme = createTheme();
const Whiteboard: React.FC = () => {
    const canvasRef = useRef < HTMLCanvasElement > (null);
    const [mode, setMode] = useState < Mode > ('none');
    // Pan and Zoom States
    const [panOffset, setPanOffset] = useState < Point > ({x: 0, y: 0});
    const [zoom, setZoom] = useState(1);
    const [paths, setPaths] = useState < Path[] > ([]); // All drawn paths
    const [currentPath, setCurrentPath] = useState < Point[] > ([]); // Path being drawn
    const [undoStack, setUndoStack] = useState < Path[] > ([]);
    const [redoStack, setRedoStack] = useState < Path[] > ([]);
    const [lastPanPosition, setLastPanPosition] = useState < Point | null > (null);
    // Drawing settings
    const [color, setColor] = useState < string > ('#000000'); // Default color is black
    const [size, setSize] = useState < number > (5); // Default size is 5
    const [canDraw, setCanDraw] = useState < boolean > (false);
    // Waypoints
    const [waypoints, setWaypoints] = useState < Waypoint[] > ([]);
    const [waypointIdCounter, setWaypointIdCounter] = useState < number > (0);
    // Selected Waypoint ID for the dropdown
    const [selectedWaypointId, setSelectedWaypointId] = useState < number | '' > ('');
    // Active pointers for multi-touch gestures
    const [activePointers, setActivePointers] = useState < Map < number,
        Point >> (new Map());
    // Backup of the drawing
    const [drawingBackup, setDrawingBackup] = useState < Path[] > ([]);
    // State for menu and drawers
    const [anchorEl, setAnchorEl] = useState < null | HTMLElement > (null);
    const [isDrawerOpen, setIsDrawerOpen] = useState < boolean > (false);
    useEffect(() => { // Initialize Socket.IO client
        socketInitializer();
        document.addEventListener('contextmenu', event => { // Remove Right Click Default
            event.preventDefault();
        });
        const canvas = canvasRef.current;
        if (canvas) {
            const ctx = canvas.getContext('2d');
            const ratio = window.devicePixelRatio || 1;
            // Adjust the canvas dimensions to match the pixel ratio
            canvas.width = window.innerWidth * ratio;
            canvas.height = window.innerHeight * ratio;
            // Scale the context to normalize drawing
            if (ctx) 
                ctx.scale(ratio, ratio);
            
            // Set the canvas style size to fill the screen
            canvas.style.width = `${
                window.innerWidth
            }px`;
            canvas.style.height = `${
                window.innerHeight
            }px`;
            redrawCanvas();
        }
        // Add resize event listener
        const handleResize = () => {
            if (canvasRef.current) {
                const ctx = canvasRef.current.getContext('2d');
                const ratio = window.devicePixelRatio || 1;
                canvasRef.current.width = window.innerWidth * ratio;
                canvasRef.current.height = window.innerHeight * ratio;
                if (ctx) 
                    ctx.scale(ratio, ratio);
                
                redrawCanvas();
            }
        };
        window.addEventListener('resize', handleResize);
        // Clean up
        return() => {
            window.removeEventListener('resize', handleResize);
            if (socket) {
                socket.disconnect();
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useEffect(() => {
        redrawCanvas();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        paths,
        currentPath,
        panOffset,
        zoom,
        waypoints
    ]);
    const socketInitializer = () => {
        socket = io();
        socket.on('connect', () => {
            console.log('Connected to socket server');
        });
        // Receive initial drawing data
        socket.on('initialize', (data : {
            paths: Path[];
            waypoints?: Waypoint[]
        }) => {
            setPaths(data.paths);
            setWaypoints(data.waypoints || []);
            // Update waypointIdCounter to the highest existing waypoint ID
            const maxWaypointId = (data.waypoints || []).reduce((maxId, wp) => Math.max(maxId, wp.id), 0);
            setWaypointIdCounter(maxWaypointId);
            redrawCanvas();
        });
        // Listen for drawing data from the server
        socket.on('drawing', (data : Path) => {
            setPaths((prevPaths) => [
                ...prevPaths,
                data
            ]);
            redrawCanvas();
        });
        // Listen for 'clear' events from the server
        socket.on('clear', () => {
            setPaths([]);
            setUndoStack([]);
            setRedoStack([]);
            redrawCanvas();
        });
        // Listen for 'undo' events from the server
        socket.on('undo', () => {
            setPaths((prev) => prev.slice(0, -1));
            redrawCanvas();
        });
        // Listen for waypoint updates
        socket.on('updateWaypoints', (data : Waypoint[]) => {
            setWaypoints(data);
            // Update waypointIdCounter to the highest existing waypoint ID
            const maxWaypointId = (data || []).reduce((maxId, wp) => Math.max(maxId, wp.id), 0);
            setWaypointIdCounter(maxWaypointId);
            redrawCanvas();
        });
    };
    const authenticate = () => {
        const password = prompt('Enter admin password:');
        if (!password) 
            return;
        
        socket.emit('authenticate', password, (ok : boolean) => {
            setCanDraw(ok);
            alert(ok ? 'Authenticated successfully.' : 'Authentication failed.');
        });
    };
    const logout = () => {
        socket.emit('logout');
        setCanDraw(false);
        alert('Logged out.');
    };
    // Convert screen coordinates to canvas coordinates based on pan and zoom
    const transformCoordinates = (clientX : number, clientY : number) => {
        const canvas = canvasRef.current;
        if (! canvas) 
            return {x: clientX, y: clientY};
        
        // Get the bounding rectangle of the canvas
        const rect = canvas.getBoundingClientRect();
        // Calculate the canvas coordinates
        const x = (clientX - rect.left - panOffset.x) / zoom;
        const y = (clientY - rect.top - panOffset.y) / zoom;
        return {x, y};
    };
    // Start drawing path
    const startDrawing = (x : number, y : number) => {
        if (!canDraw) 
            return;
        
        if (mode !== 'none') 
            return;
        
        setCurrentPath([{
                x,
                y
            }]);
        setMode('drawing');
    };
    // Draw line to cursor
    const draw = (x : number, y : number) => {
        if (!canDraw) 
            return;
        
        if (mode !== 'drawing') 
            return;
        
        setCurrentPath((prevPath) => [
            ...prevPath, {
                x,
                y
            }
        ]);
        redrawCanvas();
    };
    // Finish drawing path
    const stopDrawing = () => {
        if (!canDraw) 
            return;
        
        if (mode === 'drawing') {
            const newPath = {
                points: currentPath,
                color,
                size
            };
            setPaths((prevPaths) => [
                ...prevPaths,
                newPath
            ]);
            setCurrentPath([]);
            setMode('none');
            redrawCanvas();
            // Clear redo stack
            setRedoStack([]);
            // Emit the drawing data to the server
            socket.emit('drawing', newPath);
        }
    };
    // Start panning
    const startPan = (x : number, y : number) => {
        if (mode !== 'none') 
            return;
        
        setMode('panning');
        setLastPanPosition({x, y});
    };
    // Pan canvas by moving offset
    const pan = (dx : number, dy : number) => {
        setPanOffset((prev) => ({
            x: prev.x + dx,
            y: prev.y + dy
        }));
        redrawCanvas();
    };
    // Stop panning
    const stopPan = () => {
        if (mode === 'panning') {
            setMode('none');
            setLastPanPosition(null);
        }
    };
    // Handle zooming (mouse wheel and touch pinch)
    const handleZoom = (event : React.WheelEvent | WheelEvent) => {
        event.preventDefault();
        const scaleAmount = 1.1;
        const delta = (event.deltaY || (event as any).wheelDelta) < 0
            ? scaleAmount
            : 1 / scaleAmount;
        const newZoom = zoom * delta;
        const canvas = canvasRef.current;
        if (! canvas) 
            return;
        
        const rect = canvas.getBoundingClientRect();
        const mouseX = (event as any).clientX - rect.left;
        const mouseY = (event as any).clientY - rect.top;
        const x = (mouseX - panOffset.x) / zoom;
        const y = (mouseY - panOffset.y) / zoom;
        // Update zoom
        setZoom(newZoom);
        // Adjust panOffset so that the point under the mouse remains under the mouse after zoom
        setPanOffset({
            x: mouseX - x * newZoom,
            y: mouseY - y * newZoom
        });
        redrawCanvas();
    };
    // Handle touch events for 2-finger panning and 3-finger zooming
    const handleTouchStart = (event : React.TouchEvent < HTMLCanvasElement >) => {
        event.preventDefault(); // Prevent default touch behavior
        const touches = event.touches;
        if (touches.length === 1) { // If there is one touch, start drawing
            const touch = touches[0];
            const {x, y} = transformCoordinates(touch.clientX, touch.clientY);
            startDrawing(x, y); // Start drawing at the transformed coordinates
        } else if (touches.length === 2) { // If there are two touches, start panning
            setMode('panning');
            const touch1 = touches[0];
            const touch2 = touches[1];
            const midX = (touch1.clientX + touch2.clientX) / 2;
            const midY = (touch1.clientY + touch2.clientY) / 2;
            setLastPanPosition({x: midX, y: midY});
        } else if (touches.length === 3) { // If there are three touches, start zooming
            setMode('zooming');
            const touch1 = touches[0];
            const touch2 = touches[1];
            const touch3 = touches[2];
            setActivePointers(new Map([
                [
                    touch1.identifier, {
                        x: touch1.clientX,
                        y: touch1.clientY
                    }
                ],
                [
                    touch2.identifier, {
                        x: touch2.clientX,
                        y: touch2.clientY
                    }
                ],
                [
                    touch3.identifier, {
                        x: touch3.clientX,
                        y: touch3.clientY
                    }
                ]
            ]));
        }
    };
    const handleTouchMove = (event : React.TouchEvent < HTMLCanvasElement >) => {
        event.preventDefault(); // Prevent default touch behavior
        const touches = event.touches;
        if (touches.length === 1 && mode === 'drawing') { // If there is one touch and we are in drawing mode, draw
            const touch = touches[0];
            const {x, y} = transformCoordinates(touch.clientX, touch.clientY);
            draw(x, y); // Draw at the transformed coordinates
        } else if (touches.length === 2 && mode === 'panning') { // If there are two touches, pan the canvas
            const touch1 = touches[0];
            const touch2 = touches[1];
            const midX = (touch1.clientX + touch2.clientX) / 2;
            const midY = (touch1.clientY + touch2.clientY) / 2;
            const dx = midX - (lastPanPosition ?. x || midX);
            const dy = midY - (lastPanPosition ?. y || midY);
            pan(dx, dy); // Pan the canvas
            setLastPanPosition({x: midX, y: midY}); // Update last pan position
        } else if (touches.length === 3 && mode === 'zooming') { // If there are three touches, handle zooming
            const touch1 = touches[0];
            const touch2 = touches[1];
            const touch3 = touches[2];
            const prevTouches = Array.from(activePointers.values());
            if (prevTouches.length === 3) {
                const prevCentroid = {
                    x: (prevTouches[0].x + prevTouches[1].x + prevTouches[2].x) / 3,
                    y: (prevTouches[0].y + prevTouches[1].y + prevTouches[2].y) / 3
                };
                const currCentroid = {
                    x: (touch1.clientX + touch2.clientX + touch3.clientX) / 3,
                    y: (touch1.clientY + touch2.clientY + touch3.clientY) / 3
                };
                let prevDistance = 0;
                let currDistance = 0;
                for (let i = 0; i < 3; i++) {
                    const prevTouch = prevTouches[i];
                    const currTouch = touches[i];
                    const dxPrev = prevTouch.x - prevCentroid.x;
                    const dyPrev = prevTouch.y - prevCentroid.y;
                    const dxCurr = currTouch.clientX - currCentroid.x;
                    const dyCurr = currTouch.clientY - currCentroid.y;
                    prevDistance += Math.hypot(dxPrev, dyPrev);
                    currDistance += Math.hypot(dxCurr, dyCurr);
                }
                const scaleAmount = currDistance / prevDistance; // Calculate the scale amount
                const newZoom = zoom * scaleAmount; // Calculate the new zoom level
                const canvas = canvasRef.current;
                if (! canvas) 
                    return;
                
                const rect = canvas.getBoundingClientRect();
                const midX = currCentroid.x - rect.left;
                const midY = currCentroid.y - rect.top;
                const x = (midX - panOffset.x) / zoom;
                const y = (midY - panOffset.y) / zoom;
                // Update zoom
                setZoom(newZoom);
                // Adjust panOffset so that the point under the fingers remains under the fingers after zoom
                setPanOffset({
                    x: midX - x * newZoom,
                    y: midY - y * newZoom
                });
                redrawCanvas(); // Redraw the canvas after zooming
            }
            // Update active pointers
            setActivePointers(new Map([
                [
                    touch1.identifier, {
                        x: touch1.clientX,
                        y: touch1.clientY
                    }
                ],
                [
                    touch2.identifier, {
                        x: touch2.clientX,
                        y: touch2.clientY
                    }
                ],
                [
                    touch3.identifier, {
                        x: touch3.clientX,
                        y: touch3.clientY
                    }
                ]
            ]));
        }
    };
    const handleTouchEnd = (event : React.TouchEvent < HTMLCanvasElement >) => {
        event.preventDefault();
        if (event.touches.length < 2 && mode === 'panning') {
            setMode('none');
            setLastPanPosition(null);
        } else if (event.touches.length < 3 && mode === 'zooming') {
            setMode('none');
            setActivePointers(new Map());
        } else if (event.touches.length === 0 && mode === 'drawing') {
            stopDrawing();
        }
    };
    // Draw grid that scales with zoom
    const drawGrid = (ctx : CanvasRenderingContext2D) => {
        const gridSize = 50;
        ctx.save();
        // Apply the same transformation for the grid
        ctx.setTransform(zoom, 0, 0, zoom, panOffset.x, panOffset.y);
        // Determine the grid lines based on the transformed coordinate space
        const canvasWidth = ctx.canvas.width / zoom;
        const canvasHeight = ctx.canvas.height / zoom;
        const startX = -panOffset.x / zoom;
        const startY = -panOffset.y / zoom;
        const endX = startX + canvasWidth;
        const endY = startY + canvasHeight;
        const firstGridLineX = Math.floor(startX / gridSize) * gridSize;
        const firstGridLineY = Math.floor(startY / gridSize) * gridSize;
        ctx.beginPath();
        ctx.strokeStyle = '#e0e0e0';
        ctx.lineWidth = 1 / zoom;
        for (let x = firstGridLineX; x <= endX; x += gridSize) {
            ctx.moveTo(x, startY);
            ctx.lineTo(x, endY);
        }
        for (let y = firstGridLineY; y <= endY; y += gridSize) {
            ctx.moveTo(startX, y);
            ctx.lineTo(endX, y);
        }
        ctx.stroke();
        ctx.restore();
    };
    // Draw waypoints
    const drawWaypoints = (ctx : CanvasRenderingContext2D) => {
        ctx.save();
        ctx.setTransform(zoom, 0, 0, zoom, panOffset.x, panOffset.y);
        waypoints.forEach((waypoint) => {
            ctx.beginPath();
            ctx.fillStyle = 'red';
            ctx.arc(waypoint.position.x, waypoint.position.y, 10 / zoom, 0, Math.PI * 2);
            ctx.fill();
            // Draw waypoint label
            ctx.fillStyle = 'black';
            ctx.font = `${
                14 / zoom
            }px Arial`;
            ctx.fillText(`${
                waypoint.name
            }`, waypoint.position.x + 12 / zoom, waypoint.position.y - 12 / zoom);
        });
        ctx.restore();
    };
    // Draw stored paths and the current path being drawn
    const drawPaths = (ctx : CanvasRenderingContext2D) => {
        ctx.save();
        ctx.setTransform(zoom, 0, 0, zoom, panOffset.x, panOffset.y);
        paths.forEach((path) => {
            ctx.beginPath();
            ctx.strokeStyle = path.color;
            ctx.lineWidth = path.size / zoom; // Adjust line width based on zoom
            path.points.forEach((point, index) => {
                if (index === 0) 
                    ctx.moveTo(point.x, point.y);
                 else 
                    ctx.lineTo(point.x, point.y);
                
            });
            ctx.stroke();
        });
        // Draw the current path
        if (currentPath.length > 0) {
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = size / zoom; // Adjust line width based on zoom
            currentPath.forEach((point, index) => {
                if (index === 0) 
                    ctx.moveTo(point.x, point.y);
                 else 
                    ctx.lineTo(point.x, point.y);
                
            });
            ctx.stroke();
        }
        ctx.restore();
    };
    // Redraw canvas, including grid and all paths
    const redrawCanvas = () => {
        const canvas = canvasRef.current;
        if (! canvas) 
            return;
        
        const context = canvas.getContext('2d');
        if (! context) 
            return;
        
        // Fill the canvas with white background
        context.fillStyle = '#FFFFFF'; // Set the fill color to white
        context.fillRect(0, 0, canvas.width, canvas.height);
        // Draw grid
        drawGrid(context);
        // Draw paths
        drawPaths(context);
        // Draw waypoints
        drawWaypoints(context);
    };
    // Undo functionality
    const undo = () => {
        if (!canDraw) 
            return;
        
        if (paths.length === 0) 
            return;
        
        const lastPath = paths[paths.length - 1];
        setUndoStack((prev) => [
            ...prev,
            lastPath
        ]);
        setPaths((prev) => prev.slice(0, -1));
        redrawCanvas();
        // Emit 'undo' event to other clients
        socket.emit('undo');
        // Clear redo stack on undo
        setRedoStack((prev) => [
            lastPath,
            ...prev
        ]);
    };
    // Redo functionality
    const redo = () => {
        if (!canDraw) 
            return;
        
        if (redoStack.length === 0) 
            return;
        
        const restoredPath = redoStack[0];
        setRedoStack((prev) => prev.slice(1));
        setPaths((prev) => [
            ...prev,
            restoredPath
        ]);
        redrawCanvas();
        // Emit the drawing data to the server
        socket.emit('drawing', restoredPath);
    };
    // Save drawing to localStorage
    const saveDrawing = () => {
        const drawingData = {
            paths,
            panOffset,
            zoom,
            waypoints
        };
        localStorage.setItem('drawing', JSON.stringify(drawingData));
        alert('Drawing saved!');
    };
    // Load drawing from localStorage
    const loadDrawing = () => {
        const savedData = localStorage.getItem('drawing');
        if (savedData) {
            const {paths, panOffset, zoom, waypoints} = JSON.parse(savedData);
            setPaths(paths);
            setPanOffset(panOffset);
            setZoom(zoom);
            setWaypoints(waypoints || []);
            // Update waypointIdCounter to the highest existing waypoint ID
            const maxWaypointId = (waypoints || []).reduce((maxId : number, wp : {
                id: number
            }) => Math.max(maxId, wp.id), 0);
            setWaypointIdCounter(maxWaypointId);
            redrawCanvas();
            alert('Drawing loaded!');
        } else {
            alert('No drawing found in local storage.');
        }
    };
    // Place a new waypoint
    const placeWaypoint = (x : number, y : number) => {
        if (mode !== 'placingWaypoint') 
            return;
        
        const name = prompt('Enter waypoint name:');
        if (name === null) { // User cancelled the prompt
            setMode('none');
            return;
        }
        if (! name.trim()) {
            alert('Waypoint name is required.');
            return;
        }
        const newWaypoint: Waypoint = {
            id: waypointIdCounter + 1,
            name,
            position: {
                x,
                y
            }
        };
        setWaypointIdCounter((prev) => prev + 1);
        setWaypoints((prevWaypoints) => {
            const updatedWaypoints = [
                ...prevWaypoints,
                newWaypoint
            ];
            // Emit waypoints to server
            socket.emit('updateWaypoints', updatedWaypoints);
            return updatedWaypoints;
        });
        setMode('none');
    };
    // Delete a waypoint
    const deleteWaypoint = (waypointId : number) => {
        if (!canDraw) 
            return;
        
        const confirmed = window.confirm('Are you sure you want to delete this waypoint?');
        if (confirmed) {
            setWaypoints((prevWaypoints) => {
                const updatedWaypoints = prevWaypoints.filter((wp) => wp.id !== waypointId);
                // Emit waypoints to server
                socket.emit('updateWaypoints', updatedWaypoints);
                return updatedWaypoints;
            });
            setSelectedWaypointId('');
        }
    };
    // Navigate to a waypoint
    const goToWaypoint = (waypoint : Waypoint) => {
        setPanOffset({
            x: window.innerWidth / 2 - waypoint.position.x * zoom,
            y: window.innerHeight / 2 - waypoint.position.y * zoom
        });
        redrawCanvas();
    };
    // Handle clicking on waypoints
    const handleCanvasClick = (x : number, y : number) => {
        if (mode === 'placingWaypoint') {
            placeWaypoint(x, y);
            return;
        }
        // Check if a waypoint was clicked
        for (const waypoint of waypoints) {
            const dx = x - waypoint.position.x;
            const dy = y - waypoint.position.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < 10 / zoom) { // Waypoint clicked
                goToWaypoint(waypoint);
                break;
            }
        }
    };
    // Event handlers for pointer events
    const handlePointerDown = (event : React.PointerEvent < HTMLCanvasElement >) => {
        const canvas = canvasRef.current;
        if (! canvas) 
            return;
        
        event.preventDefault();
        canvas.setPointerCapture(event.pointerId);
        const clientPoint = {
            x: event.clientX,
            y: event.clientY
        };
        setActivePointers((prev) => {
            const newMap = new Map(prev);
            newMap.set(event.pointerId, clientPoint);
            return newMap;
        });
        const {x, y} = transformCoordinates(event.clientX, event.clientY);
        if (event.pointerType === 'touch' || event.pointerType === 'pen') {
            if (activePointers.size + 1 === 1) {
                if (mode === 'placingWaypoint') {
                    placeWaypoint(x, y);
                } else {
                    startDrawing(x, y);
                }
            } else if (activePointers.size + 1 === 2) { // Start panning
                setMode('panning');
                setLastPanPosition(clientPoint);
            } else if (activePointers.size + 1 === 3) { // Start zooming
                setMode('zooming');
            }
        } else if (event.pointerType === 'mouse') {
            if (event.button === 2) {
                startPan(event.clientX, event.clientY);
            } else if (event.button === 0) {
                if (mode === 'placingWaypoint') {
                    placeWaypoint(x, y);
                } else {
                    startDrawing(x, y);
                }
            }
        }
    };
    const handlePointerMove = (event : React.PointerEvent < HTMLCanvasElement >) => {
        const clientPoint = {
            x: event.clientX,
            y: event.clientY
        };
        setActivePointers((prev) => {
            if (!prev.has(event.pointerId)) 
                return prev;
            
            const newMap = new Map(prev);
            newMap.set(event.pointerId, clientPoint);
            return newMap;
        });
        const {x, y} = transformCoordinates(event.clientX, event.clientY);
        if (mode === 'drawing') {
            draw(x, y);
        } else if (mode === 'panning') {
            if (activePointers.size >= 2) {
                const dx = clientPoint.x -(lastPanPosition ?. x || clientPoint.x);
                const dy = clientPoint.y -(lastPanPosition ?. y || clientPoint.y);
                pan(dx, dy);
                setLastPanPosition(clientPoint);
            } else if (event.pointerType === 'mouse') { // For mouse panning
                const dx = event.clientX -(lastPanPosition ?. x || event.clientX);
                const dy = event.clientY -(lastPanPosition ?. y || event.clientY);
                pan(dx, dy);
                setLastPanPosition({x: event.clientX, y: event.clientY});
            }
        } else if (mode === 'zooming') { // Implement zooming logic for pointer events if needed
        }
    };
    const handlePointerUp = (event : React.PointerEvent < HTMLCanvasElement >) => {
        const canvas = canvasRef.current;
        if (! canvas) 
            return;
        
        canvas.releasePointerCapture(event.pointerId);
        setActivePointers((prev) => {
            const newMap = new Map(prev);
            newMap.delete(event.pointerId);
            return newMap;
        });
        if (mode === 'drawing') {
            stopDrawing();
        }
        if (mode === 'panning' && activePointers.size <= 1) {
            stopPan();
        }
        if (mode === 'zooming' && activePointers.size <= 2) {
            setMode('none');
        }
    };
    const handlePointerLeave = (event : React.PointerEvent < HTMLCanvasElement >) => {
        setActivePointers((prev) => {
            const newMap = new Map(prev);
            newMap.delete(event.pointerId);
            return newMap;
        });
        if (mode === 'drawing') {
            stopDrawing();
        }
        if (mode === 'panning' && activePointers.size <= 1) {
            stopPan();
        }
        if (mode === 'zooming' && activePointers.size <= 2) {
            setMode('none');
        }
    };
    const handleCanvasClickEvent = (event : React.MouseEvent < HTMLCanvasElement >) => {
        const {x, y} = transformCoordinates(event.clientX, event.clientY);
        handleCanvasClick(x, y);
    };
    // Menu handlers
    const handleMenuOpen = (event : React.MouseEvent < HTMLElement >) => {
        setAnchorEl(event.currentTarget);
    };
    const handleMenuClose = () => {
        setAnchorEl(null);
    };
    const toggleDrawer = (open : boolean) => {
        setIsDrawerOpen(open);
    };
    return (<ThemeProvider theme={theme}>
        <div style={
            {
                position: 'relative',
                overflow: 'hidden'
            }
        }> {/* Canvas */}
            <canvas ref={canvasRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerLeave}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onClick={handleCanvasClickEvent}
                onWheel={handleZoom}
                style={
                    {
                        width: '100vw',
                        height: '100vh',
                        touchAction: 'none',
                        cursor: mode === 'panning'
                            ? 'grabbing'
                            : mode === 'placingWaypoint'
                                ? 'pointer'
                                : 'crosshair',
                        display: 'block'
                    }
                }/> {/* App Bar */}
            <AppBar position="fixed" color="default"
                style={
                    {
                        top: 'auto',
                        bottom: 0
                    }
            }>
                <Toolbar variant="dense">
                    <Tooltip title="Draw">
                        <IconButton color={
                                mode === 'drawing'
                                    ? 'primary'
                                    : 'default'
                            }
                            onClick={
                                () => setMode('drawing')
                        }>
                            <BrushIcon/>
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Place Waypoint">
                        <IconButton color={
                                mode === 'placingWaypoint'
                                    ? 'primary'
                                    : 'default'
                            }
                            onClick={
                                () => setMode('placingWaypoint')
                        }>
                            <PlaceIcon/>
                        </IconButton>
                    </Tooltip>
                    <Divider orientation="vertical" flexItem
                        style={
                            {margin: '0 10px'}
                        }/>
                    <Tooltip title="Undo">
                        <IconButton onClick={undo}>
                            <UndoIcon/>
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Redo">
                        <IconButton onClick={redo}>
                            <RedoIcon/>
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Clear">
                        <IconButton onClick={
                            () => {
                                const confirmed = window.confirm('Are you sure you want to clear the canvas?');
                                if (confirmed) { // Save backup
                                    setDrawingBackup(paths);
                                    setPaths([]);
                                    setUndoStack([]);
                                    setRedoStack([]);
                                    socket.emit('clear');
                                }
                            }
                        }>
                            <DeleteIcon/>
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Save">
                        <IconButton onClick={saveDrawing}>
                            <SaveIcon/>
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Load">
                        <IconButton onClick={loadDrawing}>
                            <RestoreIcon/>
                        </IconButton>
                    </Tooltip>
                    <Divider orientation="vertical" flexItem
                        style={
                            {margin: '0 10px'}
                        }/>
                    <Tooltip title="More Options">
                        <IconButton edge="end"
                            onClick={handleMenuOpen}>
                            <MoreVertIcon/>
                        </IconButton>
                    </Tooltip>
                    <Menu anchorEl={anchorEl}
                        open={
                            Boolean(anchorEl)
                        }
                        onClose={handleMenuClose}> {
                        !canDraw
                            ? (<MenuItem onClick={
                                () => {
                                    handleMenuClose();
                                    authenticate();
                                }
                            }>
                                Draw
                            </MenuItem>)
                            : (<MenuItem onClick={
                                () => {
                                    handleMenuClose();
                                    logout();
                                }
                            }>
                                Stop Drawing
                            </MenuItem>)
                    }
                        <MenuItem onClick={
                            () => {
                                handleMenuClose();
                                toggleDrawer(true);
                            }
                        }>
                            Waypoints
                        </MenuItem>
                    </Menu>
                </Toolbar>
            </AppBar>
            {/* Waypoints Drawer */}
            <Drawer anchor="right"
                open={isDrawerOpen}
                onClose={
                    () => toggleDrawer(false)
            }>
                <Box sx={
                    {
                        width: 300,
                        padding: 2
                    }
                }>
                    <List>
                        <ListItem>
                            <ListItemText primary="Waypoints"/>
                        </ListItem>
                        <Divider/> {
                        waypoints.length > 0
                            ? (<>
                                <FormControl fullWidth>
                                    <InputLabel id="waypoint-select-label">Select Waypoint</InputLabel>
                                    <Select labelId="waypoint-select-label"
                                        value={selectedWaypointId}
                                        label="Select Waypoint"
                                        onChange={
                                            (e) => {
                                                const selectedId = e.target.value as number;
                                                const selectedWaypoint = waypoints.find((wp) => wp.id === selectedId);
                                                if (selectedWaypoint) {
                                                    setSelectedWaypointId(selectedId);
                                                    goToWaypoint(selectedWaypoint);
                                                }
                                            }
                                    }> {
                                        waypoints.map((wp) => (<MenuItem key={
                                                wp.id
                                            }
                                            value={
                                                wp.id
                                        }> {
                                            wp.name
                                        } </MenuItem>))
                                    } </Select>
                                </FormControl>
                                {
                                canDraw && selectedWaypointId && (<Button variant="contained" color="secondary"
                                    onClick={
                                        () => deleteWaypoint(selectedWaypointId as number)
                                    }
                                    sx={
                                        {marginTop: 2}
                                }>
                                    Delete Waypoint
                                </Button>)
                            } </>)
                            : (<ListItem>
                                <ListItemText primary="No waypoints available."/>
                            </ListItem>)
                    } </List>
                </Box>
            </Drawer>
            {/* Color Picker and Size Slider */}
            {
            canDraw && (<Box sx={
                {
                    position: 'absolute',
                    top: 70,
                    left: 10,
                    backgroundColor: '#fff',
                    padding: 2,
                    borderRadius: 2,
                    zIndex: 1
                }
            }>
                <SketchPicker color={color}
                    onChangeComplete={
                        (colorResult : {
                            hex: React.SetStateAction < string >;
                        }) => {
                            setColor(colorResult.hex);
                        }
                    }/>
                <Box sx={
                    {
                        width: 150,
                        marginTop: 2
                    }
                }>
                    <Slider value={size}
                        onChange={
                            (e, val) => setSize(val as number)
                        }
                        min={1}
                        max={20}
                        aria-labelledby="brush-size-slider"/>
                    <Box sx={
                        {textAlign: 'center'}
                    }>Brush Size: {size}px</Box>
                </Box>
            </Box>)
        } </div>
    </ThemeProvider>);
};
export default Whiteboard;
