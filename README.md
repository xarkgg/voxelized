# voxelized

Turn any link into a QR code that grows a voxel object when you tilt it.

From straight above it is a normal, scannable QR code. Tilt your phone or drag it, and the camera swings into an isometric view to reveal what is really standing on it: a cherry tree, a castle, a rocket, a cat, or any emoji you type. Let go and it springs back flat, ready to scan.

## Features

- Live QR generation as you type (error correction level H)
- Ten voxel objects: cherry tree, pine tree, mushroom, house, castle, rocket, cactus, cat, heart, planet
- Random pick, plus an emoji mode that voxelizes any emoji or character
- Tilt with the device gyroscope via a Tilt on/off switch (recalibrates each time it is turned on; iOS asks for permission), drag on desktop, or use the Flat / 3D toggle
- Spring physics and a staggered voxel pop when anything changes
- Save QR exports the flat, scannable view; Save 3D exports the isometric voxel object on a transparent background (both 1200 px PNG)

## How the QR stays scannable

A top-down orthographic camera only ever sees the highest voxel in each column. After an object is sampled into voxels, every column is checked against its QR module:

- over a dark module, the top voxel is darkened to a relative luminance of 0.3 or less
- over a light module, the object is either removed (`drop` mode) or its top voxel is repainted with the model's light colour at a luminance of 0.75 or more (`tint` mode)
- finder patterns are always left clear

So from above the scene collapses back into the exact QR matrix, whatever shape is standing on it.

## Adding an object

Objects live in `models.js`. Each one is a field function that returns a colour or `null` for a point in space, measured in units of the QR's radius:

```js
myThing: {
  label: "My thing",
  mode: "tint",                 // or "drop"
  ground: ["#3e9b4a"],          // finder pattern colours
  dark: ["#d94f93"],            // dark module colours
  light: "#fff6ef",             // top colour over light modules in tint mode
  field: function (U, V, Y, h) {
    return Math.hypot(U, V, Y - 1) < 0.6 ? "#7b5cd6" : null;
  }
}
```

It shows up in the picker automatically.

## Running it

It is a static page with no build step. Open `index.html`, or serve the folder:

```sh
npx serve .
```

three.js (r149) and qrcode-generator load from jsDelivr.
