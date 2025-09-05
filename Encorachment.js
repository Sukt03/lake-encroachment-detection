
// Encroachment and Dumping Detection (June 2024 vs 2025)
// 1. Load Lakes and Apply 1 km Buffer
var lakes = ee.FeatureCollection("projects/waterbody-464317/assets/shapefilelakes");
var buffer = lakes.map(function(f) { return f.buffer(1000); });
Map.centerObject(buffer, 13);

Map.addLayer(lakes.style({color: 'black'}), {}, 'Lake Boundary');
Map.addLayer(buffer.style({color: 'red', fillColor: '00000000'}), {}, '1 km Buffer');

// 2. Sentinel-2 Composite with NDBI
function maskS2(image) {
  return image.updateMask(image.select("B8").gt(0));
}

function addIndices(image) {
  var ndbi = image.normalizedDifference(['B11', 'B8']).rename('NDBI');
  return image.addBands(ndbi);
}

function getComposite(start, end) {
  return addIndices(
    ee.ImageCollection("COPERNICUS/S2_SR")
      .filterBounds(buffer)
      .filterDate(start, end)
      .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 30))
      .map(maskS2)
      .median()
      .clip(buffer)
  );
}

// 3. Open Buildings & DEM
var buildings = ee.FeatureCollection("GOOGLE/Research/open-buildings/v3/polygons")
  .filterBounds(buffer)
  .filter(ee.Filter.gt('confidence', 0.75));
var dem = ee.Image("USGS/SRTMGL1_003");

// 4. Process for June 2024 and 2025
var s2_2024 = getComposite('2024-06-01', '2024-06-30');
var s2_2025 = getComposite('2025-06-01', '2025-06-30');

var ndbi2024 = s2_2024.select('NDBI').gt(0.1);
var ndbi2025 = s2_2025.select('NDBI').gt(0.1);

var dw2024 = ee.ImageCollection("GOOGLE/DYNAMICWORLD/V1")
  .filterBounds(buffer).filterDate('2024-06-01', '2024-06-30')
  .select('label').mode().clip(buffer);

var dw2025 = ee.ImageCollection("GOOGLE/DYNAMICWORLD/V1")
  .filterBounds(buffer).filterDate('2025-06-01', '2025-06-30')
  .select('label').mode().clip(buffer);

var dwBuilt2024 = dw2024.eq(1);
var dwBuilt2025 = dw2025.eq(1);

// 5. Dumping Zones via Building Buffers
var dumping = buildings.map(function(f) { return f.buffer(50); });
var dumpingRaster = ee.Image().byte().paint(dumping, 1).clip(buffer);

// 6. Visualization Layers
Map.addLayer(ndbi2024.updateMask(ndbi2024), {palette: ['#8B4513']}, 'NDBI Construction 2024');
Map.addLayer(dwBuilt2024.updateMask(dwBuilt2024), {palette: ['#FFA500']}, 'Dynamic World Built-up 2024');
Map.addLayer(dumpingRaster.updateMask(dumpingRaster), {palette: ['#FF0000']}, 'Dumping Zones 2024');

Map.addLayer(ndbi2025.updateMask(ndbi2025), {palette: ['#8B4513']}, 'NDBI Construction 2025');
Map.addLayer(dwBuilt2025.updateMask(dwBuilt2025), {palette: ['#FFA500']}, 'Dynamic World Built-up 2025');
Map.addLayer(dumpingRaster.updateMask(dumpingRaster), {palette: ['#FF0000']}, 'Dumping Zones 2025');

// Change Maps
var builtDiff = dwBuilt2025.subtract(dwBuilt2024);
var ndbiDiff = ndbi2025.subtract(ndbi2024);

Map.addLayer(builtDiff.updateMask(builtDiff), {palette: ['#FF8C00']}, 'Built-up Gain (DW)');
Map.addLayer(ndbiDiff.updateMask(ndbiDiff), {palette: ['#A0522D']}, 'Construction Gain (NDBI)');

// Area Calculations: Encroachment and Dumping
var pixelArea = ee.Image.pixelArea().divide(1e6);  // Convert to km²

// Encroachment Gain (NDBI-based)
var encroachmentGain = ndbi2025.and(ndbiDiff.eq(1));
var encroachArea = pixelArea.updateMask(encroachmentGain).reduceRegion({
  reducer: ee.Reducer.sum(),
  geometry: buffer.geometry(),
  scale: 10,
  maxPixels: 1e13
});
print("Encroachment (NDBI Gain) Area 2025 (km²):", encroachArea);

// Dumping Area (Buffered Buildings)
var dumpingArea = pixelArea.updateMask(dumpingRaster).reduceRegion({
  reducer: ee.Reducer.sum(),
  geometry: buffer.geometry(),
  scale: 10,
  maxPixels: 1e13
});
print("Dumping Area (Open Buildings Buffer) 2025 (km²):", dumpingArea);

// Dynamic World Water Change
function getDWWater(start, end) {
  var dw = ee.ImageCollection("GOOGLE/DYNAMICWORLD/V1")
    .filterBounds(buffer)
    .filterDate(start, end)
    .select('label')
    .mode()
    .clip(buffer);
  return dw.eq(0); // Class 0 = Water
}

var dwWater2024 = getDWWater('2024-06-01', '2024-06-30');
var dwWater2025 = getDWWater('2025-06-01', '2025-06-30');

Map.addLayer(dwWater2024.updateMask(dwWater2024), {palette: ['#0000FF']}, 'Dynamic World Water 2024');
Map.addLayer(dwWater2025.updateMask(dwWater2025), {palette: ['#00FFFF']}, 'Dynamic World Water 2025');

// Water Change
var waterChange = dwWater2025.subtract(dwWater2024);
Map.addLayer(waterChange, {
  min: -1, max: 1,
  palette: ['#FF0000', 'white', '#0000FF']
}, 'Water Change 2024–2025');

// Water Area Calculation
var area2024 = pixelArea.updateMask(dwWater2024).reduceRegion({
  reducer: ee.Reducer.sum(),
  geometry: lakes.geometry(),
  scale: 10,
  maxPixels: 1e13
});
var area2025 = pixelArea.updateMask(dwWater2025).reduceRegion({
  reducer: ee.Reducer.sum(),
  geometry: lakes.geometry(),
  scale: 10,
  maxPixels: 1e13
});
print('Water Area 2024 (km²):', area2024);
print('Water Area 2025 (km²):', area2025);
// Vegetation Change (2024–2025)

function addIndices(img) {
  var ndvi = img.normalizedDifference(['B8', 'B4']).rename('NDVI');
  return img.addBands(ndvi);
}

function getS2Composite(start, end) {
  return addIndices(
    ee.ImageCollection('COPERNICUS/S2_SR')
      .filterBounds(buffer)
      .filterDate(start, end)
      .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
      .median()
      .clip(buffer)
  );
}

var s2_2024veg = getS2Composite('2024-06-01', '2025-05-31');
var s2_2025veg = getS2Composite('2025-06-01', '2026-05-31');

var veg2024 = s2_2024veg.select('NDVI').gt(0.3);
var veg2025 = s2_2025veg.select('NDVI').gt(0.3);

var vegChange = veg2025.subtract(veg2024);

Map.addLayer(veg2024.updateMask(veg2024), {palette: ['#00FF7F']}, 'Vegetation 2024–25');
Map.addLayer(veg2025.updateMask(veg2025), {palette: ['#228B22']}, 'Vegetation 2025–26');
Map.addLayer(vegChange, {
  min: -1, max: 1,
  palette: ['#FF1493', 'white', '#00FF00']
}, 'Vegetation Change (Loss/Gain)');

// Vegetation Area Calculations
var areaVeg2024 = pixelArea.updateMask(veg2024).reduceRegion({
  reducer: ee.Reducer.sum(),
  geometry: lakes.geometry(),
  scale: 10,
  maxPixels: 1e13
});
var areaVeg2025 = pixelArea.updateMask(veg2025).reduceRegion({
  reducer: ee.Reducer.sum(),
  geometry: lakes.geometry(),
  scale: 10,
  maxPixels: 1e13
});
print("Vegetation Area (2024–25) km²:", areaVeg2024);
print("Vegetation Area (2025–26) km²:", areaVeg2025);
