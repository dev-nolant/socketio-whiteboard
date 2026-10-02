# socketio-whiteboard

A shared whiteboard. One person draws, everyone with the link watches it update live.

Built with Next.js, a small Express server and Socket.IO. The drawing is kept in memory and saved to `drawingData.json`, so it survives restarts.

## What it does

- Draw with mouse, pen or touch
- Pan (right-click drag, or two fingers) and zoom (scroll wheel, or three fingers)
- Drop waypoints to mark spots on the board
- Undo, redo, clear
- Save the board to a file and load it back

Viewing is open to anyone. Drawing, clearing and moving waypoints need the admin password, which the server checks on the socket connection itself.

## Running it

```sh
npm install
cp .env.example .env    # then set ADMIN_PASSWORD
npm run dev
```

Open http://localhost:3000, then pick **Draw** from the menu (top right) and enter the password.

For production: `npm run build`, then `npm start`.

## License

MIT
