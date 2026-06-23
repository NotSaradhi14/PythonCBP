/* ═══════════════════════════════════════════════════════
   SciWeather — Frontend Logic
   ═══════════════════════════════════════════════════════ */

// â”€â”€â”€ State â”€â”€â”€
let currentWeather = null;

// â”€â”€â”€ Navigation â”€â”€â”€
document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
    });
});

// Enter key for city search
document.getElementById("city-input").addEventListener("keydown", e => {
    if (e.key === "Enter") fetchWeather();
});

// ═══════════════════════════════════════════════════════
//  INTERACTIVE GLOBE (Three.js)
// ═══════════════════════════════════════════════════════

let globeScene, globeCamera, globeRenderer, globeMesh, starsMesh;
let globeSpinning = true;
let globeDragging = false;
let globeMouseMoved = false;
let globePrevMouse = { x: 0, y: 0 };
let globeRotationVelocity = { x: 0, y: 0.003 };
let globeCurrentRotation = { x: 0.3, y: 0 };
let globeRaycaster = new THREE.Raycaster();
let globeClickedLocation = null;
let globeFlyTarget = null;

function initGlobe() {
    const container = document.getElementById('globe-container');
    const canvas = document.getElementById('globe-canvas');
    const W = container.clientWidth;
    const H = container.clientHeight || 340;

    // Scene
    globeScene = new THREE.Scene();

    // Camera
    globeCamera = new THREE.PerspectiveCamera(45, W / H, 0.1, 1000);
    globeCamera.position.z = 2.8;

    // Renderer
    globeRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    globeRenderer.setPixelRatio(window.devicePixelRatio);
    globeRenderer.setSize(W, H);
    globeRenderer.setClearColor(0x000000, 0);

    // — Stars background
    const starsGeo = new THREE.BufferGeometry();
    const starCount = 2000;
    const starPositions = [];
    for (let i = 0; i < starCount; i++) {
        starPositions.push(
            (Math.random() - 0.5) * 200,
            (Math.random() - 0.5) * 200,
            (Math.random() - 0.5) * 200
        );
    }
    starsGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    const starsMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.18, transparent: true, opacity: 0.7 });
    starsMesh = new THREE.Points(starsGeo, starsMat);
    globeScene.add(starsMesh);

    // — Globe sphere
    const globeGeo = new THREE.SphereGeometry(1, 64, 64);

    // Show loading indicator
    const loadingEl = document.createElement('div');
    loadingEl.id = 'globe-loading';
    loadingEl.innerHTML = '<div class="globe-loader-ring"></div><span>Loading Earth...</span>';
    document.getElementById('globe-container').appendChild(loadingEl);

    // Real NASA Earth textures
    const texLoader = new THREE.TextureLoader();
    texLoader.crossOrigin = 'anonymous';

    const EARTH_DAY   = 'https://unpkg.com/three-globe/example/img/earth-day.jpg';
    const EARTH_NIGHT = 'https://unpkg.com/three-globe/example/img/earth-night.jpg';
    const EARTH_BUMP  = 'https://unpkg.com/three-globe/example/img/earth-topology.png';
    const EARTH_SPEC  = 'https://unpkg.com/three-globe/example/img/earth-water.png';
    const EARTH_CLOUD = 'https://unpkg.com/three-globe/example/img/earth-clouds.png';

    let loadedCount = 0;
    const totalTextures = 4;
    function onTexLoaded() {
        loadedCount++;
        if (loadedCount >= totalTextures) {
            const el = document.getElementById('globe-loading');
            if (el) el.remove();
        }
    }

    const earthDayTex   = texLoader.load(EARTH_DAY,   onTexLoaded);
    const earthNightTex = texLoader.load('/api/proxy-texture?url=' + encodeURIComponent(EARTH_NIGHT), onTexLoaded);
    const earthBumpTex  = texLoader.load(EARTH_BUMP,  onTexLoaded);
    const earthSpecTex  = texLoader.load(EARTH_SPEC,  onTexLoaded);

    // — Google Earth Material with built-in Bump & Specular + Custom Day/Night Blend
    const globeMat = new THREE.MeshPhongMaterial({
        map: earthDayTex,
        bumpMap: earthBumpTex,
        bumpScale: 0.035, // Gives depth to mountains when zoomed
        specularMap: earthSpecTex,
        specular: new THREE.Color(0x224477),
        shininess: 30,
    });

    globeMat.onBeforeCompile = function(shader) {
        shader.uniforms.tNight = { value: earthNightTex };
        shader.uniforms.sunDirection = { value: new THREE.Vector3(5, 3, 5).normalize() };

        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <map_pars_fragment>',
            `
            #include <map_pars_fragment>
            uniform sampler2D tNight;
            uniform vec3 sunDirection;
            `
        );

        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <map_fragment>',
            `
            #ifdef USE_MAP
                vec4 texelColor = texture2D( map, vUv );
                vec4 nightColor = texture2D( tNight, vUv );
                nightColor.rgb *= 2.8; // Brighten city lights
                
                // Calculate dot product of view-space normal and view-space sun direction
                float cosA = dot(normalize(vNormal), normalize(sunDirection));
                float blend = smoothstep(-0.2, 0.2, cosA);
                
                texelColor = mix(nightColor, texelColor, blend);
                texelColor = mapTexelToLinear( texelColor );
                diffuseColor *= texelColor;
            #endif
            `
        );
        globeMat.userData.shader = shader;
    };

    globeMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 128), globeMat);
    globeMesh.rotation.x = globeCurrentRotation.x;
    globeScene.add(globeMesh);

    // — Cloud layer (separate sphere slightly larger)
    const cloudGeo = new THREE.SphereGeometry(1.012, 64, 64);
    const cloudTex = texLoader.load(EARTH_CLOUD);
    const cloudMat = new THREE.MeshPhongMaterial({
        map: cloudTex,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
    const cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
    globeMesh.add(cloudMesh); // attach to globe so it rotates with it
    // Slowly counter-rotate clouds for realism
    cloudMesh.userData.cloudDrift = true;

    // — Atmosphere glow (outer halo)
    const atmGeo = new THREE.SphereGeometry(1.08, 64, 64);
    const atmMat = new THREE.MeshPhongMaterial({
        color: 0x4f8ff7,
        transparent: true,
        opacity: 0.10,
        side: THREE.BackSide,
    });
    globeScene.add(new THREE.Mesh(atmGeo, atmMat));

    // — Inner atmosphere rim glow
    const rimGeo = new THREE.SphereGeometry(1.03, 64, 64);
    const rimMat = new THREE.MeshPhongMaterial({
        color: 0x6ab0ff,
        transparent: true,
        opacity: 0.06,
        side: THREE.FrontSide,
    });
    globeScene.add(new THREE.Mesh(rimGeo, rimMat));

    // — Lights
    const ambientLight = new THREE.AmbientLight(0x334466, 1.2);
    globeScene.add(ambientLight);
    const sunLight = new THREE.DirectionalLight(0xffeedd, 2.2);
    sunLight.position.set(5, 3, 5);
    globeScene.add(sunLight);
    const fillLight = new THREE.DirectionalLight(0x223366, 0.6);
    fillLight.position.set(-5, -2, -3);
    globeScene.add(fillLight);

    // — Mouse interaction
    canvas.addEventListener('mousedown', onGlobeMouseDown);
    window.addEventListener('mousemove', onGlobeMouseMove);
    window.addEventListener('mouseup', onGlobeMouseUp);
    canvas.addEventListener('touchstart', onGlobeTouchStart, { passive: true });
    window.addEventListener('touchmove', onGlobeTouchMove, { passive: true });
    window.addEventListener('touchend', onGlobeTouchEnd);

    // — Zoom (mouse wheel)
    canvas.addEventListener('wheel', onGlobeWheel, { passive: false });

    // — Resize
    window.addEventListener('resize', onGlobeResize);

    animateGlobe();
}



function animateGlobe() {
    requestAnimationFrame(animateGlobe);
    
    if (globeFlyTarget) {
        // Smoothly interpolate rotation and zoom
        globeMesh.rotation.x += (globeFlyTarget.rx - globeMesh.rotation.x) * 0.08;
        globeMesh.rotation.y += (globeFlyTarget.ry - globeMesh.rotation.y) * 0.08;
        globeCamera.position.z += (globeFlyTarget.z - globeCamera.position.z) * 0.08;

        if (
            Math.abs(globeFlyTarget.rx - globeMesh.rotation.x) < 0.001 &&
            Math.abs(globeFlyTarget.ry - globeMesh.rotation.y) < 0.001 &&
            Math.abs(globeFlyTarget.z - globeCamera.position.z) < 0.01
        ) {
            globeFlyTarget = null;
        }
    } else if (globeSpinning && !globeDragging) {
        globeMesh.rotation.y += globeRotationVelocity.y;
        globeMesh.rotation.x += globeRotationVelocity.x * 0.05;
        if (Math.abs(globeRotationVelocity.x) > 0.0001) globeRotationVelocity.x *= 0.95;
    }

    // Rotate sun slowly (full orbit ~ 8 min real time)
    if (globeMesh && globeMesh.material.userData.shader) {
        const t = Date.now() * 0.00004;
        const sunWorld = new THREE.Vector3(Math.cos(t)*5, 0.5, Math.sin(t)*5).normalize();
        const sunView = sunWorld.clone().transformDirection(globeCamera.matrixWorldInverse);
        globeMesh.material.userData.shader.uniforms.sunDirection.value.copy(sunView);
    }
    if (globeMesh) {
        globeMesh.children.forEach(child => {
            if (child.userData.cloudDrift) child.rotation.y += 0.0002;
        });
    }
    if (starsMesh) starsMesh.rotation.y += 0.0001;
    globeRenderer.render(globeScene, globeCamera);
    updateGlobeCoords();
}

function updateGlobeCoords() {
    const lon = ((globeMesh.rotation.y * 180 / Math.PI) % 360 + 360) % 360;
    const lat = Math.max(-90, Math.min(90, globeMesh.rotation.x * 180 / Math.PI));
    const lonDisplay = lon > 180 ? -(360 - lon) : lon;
    document.getElementById('globe-lat').textContent = 'LAT: ' + lat.toFixed(1) + '°';
    document.getElementById('globe-lon').textContent = 'LON: ' + lonDisplay.toFixed(1) + '°';
}

function onGlobeMouseDown(e) {
    globeFlyTarget = null; // Cancel any ongoing fly animation
    globeDragging = true;
    globeMouseMoved = false;
    globePrevMouse = { x: e.clientX, y: e.clientY };
    globeRotationVelocity = { x: 0, y: 0 };
}
function onGlobeMouseMove(e) {
    if (!globeDragging) return;
    const dx = e.clientX - globePrevMouse.x;
    const dy = e.clientY - globePrevMouse.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) globeMouseMoved = true;
    globeMesh.rotation.y += dx * 0.006;
    globeMesh.rotation.x += dy * 0.006;
    globeMesh.rotation.x = Math.max(-Math.PI/2, Math.min(Math.PI/2, globeMesh.rotation.x));
    globeRotationVelocity = { x: dy * 0.0005, y: dx * 0.004 };
    globePrevMouse = { x: e.clientX, y: e.clientY };
}
function onGlobeMouseUp(e) {
    if (!globeMouseMoved) handleGlobeClick(e);
    globeDragging = false;
    globeMouseMoved = false;
}

function onGlobeWheel(e) {
    e.preventDefault();
    globeFlyTarget = null; // Cancel any ongoing fly animation
    globeCamera.position.z += e.deltaY * 0.004;
    globeCamera.position.z = Math.max(1.4, Math.min(5.0, globeCamera.position.z));
}

// â”€â”€â”€ Click-to-pick location â”€â”€â”€
function handleGlobeClick(e) {
    const canvas = document.getElementById('globe-canvas');
    const rect = canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    globeRaycaster.setFromCamera(mouse, globeCamera);
    const hits = globeRaycaster.intersectObject(globeMesh);
    if (!hits.length) return;

    const local = globeMesh.worldToLocal(hits[0].point.clone());
    const lat = Math.asin(Math.max(-1, Math.min(1, local.y))) * 180 / Math.PI;
    let phi = Math.atan2(local.z, -local.x);
    if (phi < 0) phi += 2 * Math.PI;
    const lon = phi * 180 / Math.PI - 180;

    showGlobeLocationBar(lat, lon, '🔄 Fetching weather...', null);

    // Fetch real weather at exact coordinates
    fetch(`/api/weather-by-coords?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`)
        .then(r => r.json())
        .then(w => {
            if (w.error) {
                showGlobeLocationBar(lat, lon, 'Ocean / No data', null);
                return;
            }
            globeClickedLocation = w;
            const place = `${w.city}, ${w.country}`;
            showGlobeLocationBar(lat, lon, place, w);
        })
        .catch(() => showGlobeLocationBar(lat, lon, 'Network error', null));
}

function showGlobeLocationBar(lat, lon, name, weather) {
    document.getElementById('glb-location-name').textContent = name;
    document.getElementById('glb-location-coords').textContent =
        `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'} â€‚ ${Math.abs(lon).toFixed(4)}°${lon >= 0 ? 'E' : 'W'}`;
    const mini = document.getElementById('glb-weather-mini');
    if (weather) {
        document.getElementById('glb-temp').textContent = `${weather.temp}°C`;
        document.getElementById('glb-condition').textContent = weather.description;
        document.getElementById('glb-wind').textContent = `💨 ${weather.wind_kph} km/h`;
        document.getElementById('glb-humidity').textContent = `💧 ${weather.humidity}%`;
        document.getElementById('glb-weather-icon').src =
            `https://openweathermap.org/img/wn/${weather.icon}.png`;
        mini.style.display = 'flex';
    } else {
        mini.style.display = 'none';
    }
    document.getElementById('globe-location-bar').classList.add('active');
}

function fetchWeatherFromGlobe() {
    if (!globeClickedLocation) return;
    const city = globeClickedLocation.city || '';
    if (!city) return;
    document.getElementById('city-input').value = city;
    fetchWeather();
}

// â”€â”€â”€ Fly to Location Animation â”€â”€â”€
function flyGlobeTo(lat, lon) {
    if (!globeMesh || !globeCamera) return;
    
    // Stop spinning if it's currently spinning
    globeSpinning = false;
    const btn = document.getElementById('globe-spin-btn');
    if (btn) btn.textContent = '▶ Play';

    const targetRotX = lat * (Math.PI / 180);
    // Based on texture mapping, the prime meridian is offset
    const targetRotYBase = -lon * (Math.PI / 180) - (Math.PI / 2);
    
    // Find the shortest rotation path
    let diffY = (targetRotYBase - globeMesh.rotation.y) % (2 * Math.PI);
    if (diffY > Math.PI) diffY -= 2 * Math.PI;
    if (diffY < -Math.PI) diffY += 2 * Math.PI;
    
    const targetRotY = globeMesh.rotation.y + diffY;
    const targetZoom = 1.8; // Nice close up view

    globeFlyTarget = {
        rx: targetRotX,
        ry: targetRotY,
        z: targetZoom
    };
}

function onGlobeTouchStart(e) {
    if (e.touches.length !== 1) return;
    globeDragging = true;
    globeMouseMoved = false;
    globePrevMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    globeRotationVelocity = { x: 0, y: 0 };
}
function onGlobeTouchMove(e) {
    if (!globeDragging || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - globePrevMouse.x;
    const dy = e.touches[0].clientY - globePrevMouse.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) globeMouseMoved = true;
    globeMesh.rotation.y += dx * 0.006;
    globeMesh.rotation.x += dy * 0.006;
    globeMesh.rotation.x = Math.max(-Math.PI/2, Math.min(Math.PI/2, globeMesh.rotation.x));
    globeRotationVelocity = { x: dy * 0.0005, y: dx * 0.004 };
    globePrevMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}
function onGlobeTouchEnd(e) {
    if (!globeMouseMoved && e.changedTouches.length) handleGlobeClick(e.changedTouches[0]);
    globeDragging = false;
    globeMouseMoved = false;
}

function onGlobeResize() {
    const container = document.getElementById('globe-container');
    const W = container.clientWidth;
    const H = container.clientHeight || 340;
    globeCamera.aspect = W / H;
    globeCamera.updateProjectionMatrix();
    globeRenderer.setSize(W, H);
}

function toggleGlobeSpin() {
    globeSpinning = !globeSpinning;
    const btn = document.getElementById('globe-spin-btn');
    btn.textContent = globeSpinning ? 'â¸ Pause' : '▶ Spin';
}

function resetGlobe() {
    globeMesh.rotation.set(0.3, 0, 0);
    globeRotationVelocity = { x: 0, y: 0.003 };
    globeSpinning = true;
    document.getElementById('globe-spin-btn').textContent = 'â¸ Pause';
}

// Init globe after DOM ready
window.addEventListener('load', () => {
    initGlobe();
});



// ═══════════════════════════════════════════════════════
//  TEMPERATURE CONVERSION
// ═══════════════════════════════════════════════════════

function convertTemp(from) {
    const val = document.getElementById("conv-" + from.toLowerCase()).value;
    fetch("/api/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: val, from: from }),
    })
        .then(r => r.json())
        .then(d => {
            document.getElementById("conv-c").value = d.C;
            document.getElementById("conv-f").value = d.F;
            document.getElementById("conv-k").value = d.K;
        })
        .catch(() => { });
}

// ═══════════════════════════════════════════════════════
//  FORMULA LIBRARY
// ═══════════════════════════════════════════════════════

const FORMULAS = {
    bmi: {
        inputs: [
            { id: "f-weight", label: "Weight (kg)", value: "70" },
            { id: "f-height", label: "Height (m)", value: "1.75" },
        ],
        calc: async (vals) => {
            const r = await fetch("/api/formula", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ type: "bmi", weight: vals[0], height: vals[1] }),
            });
            const d = await r.json();
            return `BMI: ${d.result} \u2014 ${d.category}`;
        }
    },
    wind_chill: {
        inputs: [
            { id: "f-temp", label: "Temp (\u00b0C)", value: "5" },
            { id: "f-wind", label: "Wind (km/h)", value: "30" },
        ],
        calc: async (vals) => {
            const r = await fetch("/api/formula", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ type: "wind_chill", temp: vals[0], wind: vals[1] }),
            });
            const d = await r.json();
            return `Wind Chill: ${d.result}\u00b0C`;
        }
    },
    heat_index: {
        inputs: [
            { id: "f-temp", label: "Temp (\u00b0C)", value: "35" },
            { id: "f-hum", label: "Humidity (%)", value: "70" },
        ],
        calc: async (vals) => {
            const r = await fetch("/api/formula", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ type: "heat_index", temp: vals[0], humidity: vals[1] }),
            });
            const d = await r.json();
            return `Heat Index: ${d.result}\u00b0C`;
        }
    },
    uv_index: {
        inputs: [
            { id: "f-lat", label: "Latitude", value: "17" },
            { id: "f-month", label: "Month (1-12)", value: new Date().getMonth() + 1 },
        ],
        calc: async (vals) => {
            const r = await fetch("/api/formula", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ type: "uv_index", lat: vals[0], month: vals[1] }),
            });
            const d = await r.json();
            return `UV Index: ${d.result} \u2014 ${d.category}`;
        }
    }
};

let activeFormula = "bmi";

function showFormula(type) {
    activeFormula = type;
    document.querySelectorAll(".formula-tab").forEach(t => t.classList.remove("active"));
    document.querySelector(`.formula-tab[onclick="showFormula('${type}')"]`).classList.add("active");

    const f = FORMULAS[type];
    const inputsDiv = document.getElementById("formula-inputs");
    const resultDiv = document.getElementById("formula-result");

    inputsDiv.innerHTML = f.inputs.map(i =>
        `<label>${i.label}<input type="number" id="${i.id}" value="${i.value}"></label>`
    ).join("") + `<button class="btn btn-primary" style="margin-top:18px;padding:7px 16px;font-size:12px" onclick="calcFormula()">Calculate</button>`;
    resultDiv.textContent = "";
}

async function calcFormula() {
    const f = FORMULAS[activeFormula];
    const vals = f.inputs.map(i => document.getElementById(i.id).value);
    try {
        const result = await f.calc(vals);
        document.getElementById("formula-result").textContent = result;
    } catch {
        document.getElementById("formula-result").textContent = "Error";
    }
}

// Init formula
showFormula("bmi");

// ═══════════════════════════════════════════════════════
//  WEATHER
// ═══════════════════════════════════════════════════════

const W_ICONS = {
    "01d": "01d", "01n": "01n", "02d": "02d", "02n": "02n", "03d": "03d", "03n": "03n",
    "04d": "04d", "04n": "04n", "09d": "09d", "09n": "09n", "10d": "10d", "10n": "10n",
    "11d": "11d", "11n": "11n", "13d": "13d", "13n": "13n", "50d": "50d", "50n": "50n",
};

async function fetchWeather() {
    const city = document.getElementById("city-input").value.trim();
    if (!city) return;

    try {
        const [wResp, fResp] = await Promise.all([
            fetch("/api/weather?city=" + encodeURIComponent(city)),
            fetch("/api/forecast?city=" + encodeURIComponent(city)),
        ]);
        const w = await wResp.json();
        const f = await fResp.json();

        if (w.error) { alert(w.error); return; }
        currentWeather = w;
        
        // Add to recent searches
        addToRecent(w.city);

        // Fly globe to the searched city
        if (w.lat !== undefined && w.lon !== undefined) {
            flyGlobeTo(w.lat, w.lon);
            // Show location bar too so it matches the search
            showGlobeLocationBar(w.lat, w.lon, `${w.city}, ${w.country}`, w);
        }

        // City header
        document.getElementById("city-name").textContent = `${w.city}, ${w.country}`;
        
        // Calculate Local City Time
        if (w.timezone !== undefined) {
            // w.timezone is offset in seconds from UTC
            const d = new Date();
            const localTime = d.getTime();
            const localOffset = d.getTimezoneOffset() * 60000;
            const utc = localTime + localOffset;
            const targetCityTime = utc + (w.timezone * 1000);
            const targetDate = new Date(targetCityTime);
            
            const timeStr = targetDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
            const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            document.getElementById("city-local-time").textContent = `${timeStr}, ${days[targetDate.getDay()]}`;
        }
        
        const now = new Date();
        document.getElementById("city-time").textContent = "Updated: " + now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true }).toUpperCase();

        // Current weather
        document.getElementById("w-icon-img").src = `https://openweathermap.org/img/wn/${w.icon}@2x.png`;
        document.getElementById("w-temp").textContent = Math.round(w.temp);
        document.getElementById("w-desc").textContent = w.description;
        document.getElementById("w-hum").textContent = w.humidity + "%";
        document.getElementById("w-wind").textContent = w.wind_kph + " km/h";
        document.getElementById("w-feel").textContent = w.feels_like + "\u00b0C";
        document.getElementById("w-pres").textContent = w.pressure + " hPa";

        // Weather intelligence
        document.getElementById("w-heat").textContent = w.heat_index + "\u00b0C";
        document.getElementById("w-chill").textContent = w.wind_chill + "\u00b0C";
        document.getElementById("w-dew").textContent = w.dew_point + "\u00b0C";
        document.getElementById("w-uv").textContent = w.uv_index;
        document.getElementById("w-uv-cat").textContent = w.uv_category;
        
        // Air Quality
        if (w.aqi !== undefined) {
            const aqiMap = {
                1: { text: "Good", color: "#2ecc71" },
                2: { text: "Fair", color: "#f1c40f" },
                3: { text: "Moderate", color: "#e67e22" },
                4: { text: "Poor", color: "#e74c3c" },
                5: { text: "Very Poor", color: "#8e44ad" }
            };
            const aq = aqiMap[w.aqi] || { text: "Unknown", color: "#95a5a6" };
            document.getElementById("w-aqi").textContent = w.aqi;
            document.getElementById("w-aqi").style.color = aq.color;
            document.getElementById("w-aqi-sub").textContent = aq.text;
            document.getElementById("w-aqi-sub").style.color = aq.color;
            document.getElementById("w-pm25").textContent = w.pm2_5;
        }
        
        // Severe Weather Alerts
        let alertMsg = "";
        if (w.heat_index >= 40) {
            alertMsg = `EXTREME HEAT WARNING: Heat index feels like ${w.heat_index}°C. Avoid outdoor activities.`;
        } else if (w.wind_kph >= 60) {
            alertMsg = `HIGH WIND WARNING: Sustained winds of ${w.wind_kph} km/h detected.`;
        } else if (w.aqi >= 4) {
            alertMsg = `POOR AIR QUALITY: AQI levels are unsafe. Wearing a mask is advised outdoors.`;
        } else if (w.uv_category === "Extreme") {
            alertMsg = `EXTREME UV RADIATION: UV Index is ${w.uv_index}. Protect your skin.`;
        }
        
        const banner = document.getElementById("alert-banner");
        if (alertMsg) {
            document.getElementById("alert-message").textContent = alertMsg;
            banner.style.display = "flex";
        } else {
            banner.style.display = "none";
        }

        // Quick conversion from current temp
        document.getElementById("conv-c").value = Math.round(w.temp);
        convertTemp("C");

        // Fetch AI Summary asynchronously
        fetchAISummary(w);


        // Draw chart
        if (f.hourly) drawChart(f.hourly);

    } catch (err) {
        console.error(err);
    }
}

async function fetchAISummary(w) {
    const summaryCard = document.getElementById("ai-summary-card");
    const summaryText = document.getElementById("ai-summary-text");
    
    summaryCard.style.display = "block";
    summaryText.innerHTML = "Generating AI insights... <span class='ai-icon'>✨</span>";
    
    try {
        const res = await fetch("/api/ai-summary", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                city: w.city,
                temp: w.temp,
                description: w.description,
                humidity: w.humidity,
                wind: w.wind_kph
            })
        });
        const data = await res.json();
        if (data.summary) {
            summaryText.textContent = data.summary;
        } else if (data.error) {
            summaryCard.style.display = "none";
            console.warn("AI Summary error:", data.error);
        }
    } catch (e) {
        summaryCard.style.display = "none";
    }
}

// ═══════════════════════════════════════════════════════
//  TEMPERATURE CHART (Canvas)
// ═══════════════════════════════════════════════════════

function drawChart(hourly) {
    const canvas = document.getElementById("temp-chart");
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;

    canvas.width = canvas.offsetWidth * dpr;
    canvas.height = 140 * dpr;
    canvas.style.height = "140px";
    ctx.scale(dpr, dpr);

    const W = canvas.offsetWidth;
    const H = 140;
    const pad = { top: 30, bottom: 25, left: 10, right: 10 };
    const chartW = W - pad.left - pad.right;
    const chartH = H - pad.top - pad.bottom;

    const temps = hourly.map(h => h.temp);
    const minT = Math.min(...temps) - 2;
    const maxT = Math.max(...temps) + 2;

    ctx.clearRect(0, 0, W, H);

    // Grid lines
    ctx.strokeStyle = "#2a3242";
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
        const y = pad.top + (chartH / 4) * i;
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
        const tv = Math.round(maxT - (maxT - minT) * (i / 4));
        ctx.fillStyle = "#475569"; ctx.font = "10px Inter";
        ctx.fillText(tv + "\u00b0", pad.left, y - 3);
    }

    // X labels
    ctx.fillStyle = "#475569"; ctx.font = "10px Inter"; ctx.textAlign = "center";
    hourly.forEach((h, i) => {
        const x = pad.left + (chartW / (hourly.length - 1)) * i;
        ctx.fillText(h.time, x, H - 5);
    });

    // Line
    ctx.beginPath();
    ctx.strokeStyle = "#4f8ff7";
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    hourly.forEach((h, i) => {
        const x = pad.left + (chartW / (hourly.length - 1)) * i;
        const y = pad.top + chartH - ((h.temp - minT) / (maxT - minT)) * chartH;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Gradient fill
    const grad = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom);
    grad.addColorStop(0, "rgba(79,143,247,0.25)");
    grad.addColorStop(1, "rgba(79,143,247,0.02)");
    ctx.lineTo(pad.left + chartW, H - pad.bottom);
    ctx.lineTo(pad.left, H - pad.bottom);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Dots + tooltip for max temp
    const maxIdx = temps.indexOf(Math.max(...temps));
    hourly.forEach((h, i) => {
        const x = pad.left + (chartW / (hourly.length - 1)) * i;
        const y = pad.top + chartH - ((h.temp - minT) / (maxT - minT)) * chartH;
        ctx.beginPath();
        ctx.arc(x, y, i === maxIdx ? 5 : 3, 0, Math.PI * 2);
        ctx.fillStyle = i === maxIdx ? "#4f8ff7" : "#1c2333";
        ctx.fill();
        ctx.strokeStyle = "#4f8ff7";
        ctx.lineWidth = 2;
        ctx.stroke();

        if (i === maxIdx) {
            // Tooltip
            const txt = h.temp + "\u00b0C";
            ctx.font = "bold 11px Inter";
            const tw = ctx.measureText(txt).width;
            const bx = x - tw / 2 - 8;
            const by = y - 28;
            ctx.fillStyle = "#4f8ff7";
            roundRect(ctx, bx, by, tw + 16, 22, 6);
            ctx.fill();
            ctx.fillStyle = "#fff";
            ctx.textAlign = "center";
            ctx.fillText(txt, x, by + 15);
            // time below tooltip
            ctx.fillStyle = "#94a3b8";
            ctx.font = "10px Inter";
            ctx.fillText(h.time, x, by + 34);
        }
    });
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

// â”€â”€â”€ Weather Metrics into Calculator â”€â”€â”€
function insertWeatherMetric(metric) {
    if (!currentWeather) {
        alert("Please search a city first to use weather metrics!");
        return;
    }
    const val = currentWeather[metric];
    if (val !== undefined) {
        calcInput(val.toString());
    }
}

// â”€â”€â”€ Smart Tools â”€â”€â”€
function closeSmartModal() {
    document.getElementById("smart-modal-overlay").classList.remove("active");
}

function showSmartTool(type) {
    if (!currentWeather) {
        alert("Search a city first to use weather-aware tools!");
        return;
    }

    const titleEl = document.getElementById("modal-title");
    const bodyEl = document.getElementById("modal-body");

    let html = "";
    if (type === "travel") {
        titleEl.textContent = "Travel Time Calculator";
        html = `
            <div class="modal-input-group">
                <label>Distance (km)</label>
                <input type="number" id="st-dist" value="100">
            </div>
            <div class="modal-input-group">
                <label>Average Speed (km/h)</label>
                <input type="number" id="st-speed" value="60">
            </div>
            <button class="btn btn-primary" onclick="calcTravelTime()">Calculate</button>
            <div id="st-result" class="modal-result" style="display:none"></div>
        `;
    } else if (type === "fuel") {
        titleEl.textContent = "Fuel Efficiency Estimator";
        html = `
            <div class="modal-input-group">
                <label>Distance (km)</label>
                <input type="number" id="st-dist" value="100">
            </div>
            <div class="modal-input-group">
                <label>Vehicle Efficiency (km/L)</label>
                <input type="number" id="st-eff" value="15">
            </div>
            <button class="btn btn-primary" onclick="calcFuel()">Estimate</button>
            <div id="st-result" class="modal-result" style="display:none"></div>
        `;
    } else if (type === "clothing") {
        titleEl.textContent = "Clothing Advisor";
        const t = currentWeather.temp;
        let advice = t > 30 ? "Light cotton clothes, sunglasses, hat ðŸ‘•ðŸ•¶ï¸" 
                   : t > 20 ? "Light layers, comfortable casual wear ðŸ‘š" 
                   : t > 10 ? "Jacket or sweater, long pants ðŸ§¥" 
                   : "Heavy coat, scarf, gloves, warm layers ðŸ§£ðŸ§¤";
        
        const hum = currentWeather.humidity;
        if (hum > 80 && t > 20) advice += "<br><br><i>Very humid, wear breathable fabrics.</i>";
        
        html = `
            <div class="modal-result" style="display:block">
                <strong>Current Temp:</strong> ${t}°C in ${currentWeather.city}<br><br>
                <strong>Recommendation:</strong><br>
                ${advice}
            </div>
        `;
    } else if (type === "rain") {
        titleEl.textContent = "Rain Probability Calculator";
        html = `
            <button class="btn btn-primary" onclick="calcRain()">Calculate Chance</button>
            <div id="st-result" class="modal-result" style="display:none"></div>
        `;
    }

    bodyEl.innerHTML = html;
    document.getElementById("smart-modal-overlay").classList.add("active");
}

function calcTravelTime() {
    const dist = parseFloat(document.getElementById("st-dist").value) || 0;
    const speed = parseFloat(document.getElementById("st-speed").value) || 1;
    
    // Weather impacts
    let adjustedSpeed = speed;
    let impactMsg = "";
    
    if (currentWeather.wind_kph > 40) {
        adjustedSpeed *= 0.9;
        impactMsg += "<br><i>Speed reduced by 10% due to high winds.</i>";
    }
    if (currentWeather.description.toLowerCase().includes("rain")) {
        adjustedSpeed *= 0.85;
        impactMsg += "<br><i>Speed reduced by 15% due to rain.</i>";
    }
    
    const timeHours = dist / adjustedSpeed;
    const h = Math.floor(timeHours);
    const m = Math.round((timeHours - h) * 60);
    
    const res = document.getElementById("st-result");
    res.style.display = "block";
    res.innerHTML = `<strong>Estimated Time:</strong> ${h}h ${m}m ${impactMsg}`;
}

function calcFuel() {
    const dist = parseFloat(document.getElementById("st-dist").value) || 0;
    const eff = parseFloat(document.getElementById("st-eff").value) || 1;
    
    let adjustedEff = eff;
    let impactMsg = "";
    
    if (currentWeather.temp < 5) {
        adjustedEff *= 0.85; // Cold weather reduces mpg
        impactMsg += "<br><i>Efficiency reduced by ~15% due to cold weather.</i>";
    }
    
    const liters = dist / adjustedEff;
    
    const res = document.getElementById("st-result");
    res.style.display = "block";
    res.innerHTML = `<strong>Fuel Needed:</strong> ${liters.toFixed(2)} Liters ${impactMsg}`;
}

function calcRain() {
    const res = document.getElementById("st-result");
    res.style.display = "block";
    if (!currentWeather) {
        res.innerHTML = "Please search for a city first.";
        return;
    }
    
    const hum = currentWeather.humidity;
    const prob = Math.min(100, Math.max(0, Math.round(hum * 1.1 - 10)));
    const cloud = currentWeather.description.toLowerCase().includes("cloud") ? 20 : 0;
    const finalProb = Math.min(100, prob + cloud);
    
    res.innerHTML = `<strong>Estimated Rain Chance:</strong> ${finalProb}%<br><br>${finalProb > 60 ? "â˜” High chance of rain. Carry an umbrella!" : "ðŸŒ¤ï¸ Looking mostly dry!"}`;
}

// ═══════════════════════════════════════════════════════
//  AI CHAT ASSISTANT (Sci-Guide)
// ═══════════════════════════════════════════════════════

function toggleAIChat() {
    const panel = document.getElementById("ai-chat-panel");
    panel.classList.toggle("active");
    if (panel.classList.contains("active")) {
        document.getElementById("ai-input").focus();
    }
}

async function sendChatMessage() {
    const inputEl = document.getElementById("ai-input");
    const msg = inputEl.value.trim();
    if (!msg) return;

    appendChatMsg("user", msg);
    inputEl.value = "";
    
    const thinkingId = appendChatMsg("bot", "Thinking... <span class='ai-icon'>✨</span>");

    const context = currentWeather ? {
        city: currentWeather.city,
        temp: currentWeather.temp,
        feels_like: currentWeather.feels_like,
        desc: currentWeather.description,
        humidity: currentWeather.humidity,
        wind: currentWeather.wind_kph,
        heat_index: currentWeather.heat_index,
        uv: currentWeather.uv_index
    } : {};

    try {
        const res = await fetch("/api/ai-chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: msg, context: context })
        });
        const data = await res.json();
        
        const thinkingEl = document.getElementById(thinkingId);
        if (data.reply) {
            // Replace newlines with <br>
            thinkingEl.innerHTML = data.reply.replace(/\n/g, '<br>');
        } else if (data.error) {
            thinkingEl.innerHTML = `<em>Error: ${data.error}</em>`;
        }
    } catch (e) {
        document.getElementById(thinkingId).innerHTML = "<em>Failed to connect to Sci-Guide.</em>";
    }
}

function appendChatMsg(sender, html) {
    const body = document.getElementById("ai-chat-body");
    const div = document.createElement("div");
    div.className = `ai-msg ai-${sender}`;
    const id = "msg-" + Date.now();
    div.id = id;
    div.innerHTML = html;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
    return id;
}


// -------------------------------------------------------
//  SIDEBAR FEATURES (GPS, Recent, Hubs)
// -------------------------------------------------------

function fetchWeatherByGPS() {
    if (!navigator.geolocation) {
        alert("Geolocation is not supported by your browser.");
        return;
    }
    
    // Animate button
    const btn = document.querySelector(".primary-action");
    if(btn) btn.innerHTML = "Locating... <span class='ai-icon'>🧭</span>";
    
    navigator.geolocation.getCurrentPosition(async (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        
        try {
            const res = await fetch(`/api/weather-by-coords?lat=${lat}&lon=${lon}`);
            const w = await res.json();
            if (w.error) { alert(w.error); return; }
            
            // Set input and fetch full forecast
            document.getElementById("city-input").value = w.city;
            fetchWeather();
        } catch (e) {
            console.error("GPS fetch error:", e);
        } finally {
            if(btn) btn.innerHTML = `<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="3" /></svg><span>My Location</span>`;
        }
    }, () => {
        alert("Unable to retrieve your location. Please check permissions.");
        if(btn) btn.innerHTML = `<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="3" /></svg><span>My Location</span>`;
    });
}

function addToRecent(city) {
    if (!city) return;
    let recent = JSON.parse(localStorage.getItem("sciweather_recent") || "[]");
    recent = recent.filter(c => c.toLowerCase() !== city.toLowerCase());
    recent.unshift(city);
    if (recent.length > 5) recent.pop();
    localStorage.setItem("sciweather_recent", JSON.stringify(recent));
    loadRecentSearches();
}

function loadRecentSearches() {
    const listEl = document.getElementById("recent-list");
    if (!listEl) return;
    
    const recent = JSON.parse(localStorage.getItem("sciweather_recent") || "[]");
    if (recent.length === 0) {
        listEl.innerHTML = "<div class='recent-empty'>No recent searches</div>";
        return;
    }
    
    listEl.innerHTML = recent.map(city => 
        `<div class="recent-tag" onclick="document.getElementById('city-input').value='${city}'; fetchWeather();">${city}</div>`
    ).join("");
}

async function loadGlobalHubs() {
    const hubList = document.getElementById("hub-list");
    if (!hubList) return;
    
    const hubs = ["New York", "London", "Tokyo"];
    let html = "";
    
    for (const city of hubs) {
        try {
            const res = await fetch("/api/weather?city=" + encodeURIComponent(city));
            const w = await res.json();
            if (!w.error) {
                html += `
                    <div class="hub-item" onclick="document.getElementById('city-input').value='${w.city}'; fetchWeather();">
                        <div class="hub-info">
                            <span class="hub-city">${w.city}</span>
                            <span class="hub-desc">${w.description}</span>
                        </div>
                        <span class="hub-temp">${Math.round(w.temp)}°</span>
                    </div>
                `;
            }
        } catch (e) { console.error("Hub fetch error", e); }
    }
    
    if (html) {
        hubList.innerHTML = html;
    } else {
        hubList.innerHTML = "<div class='recent-empty'>Failed to load hubs</div>";
    }
}

// Call these on load
document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
        loadRecentSearches();
        loadGlobalHubs();
    }, 1000); // Small delay to let globe load first
});



// -------------------------------------------------------
//  ANTIGRAVITY MOUSE TRACKING
// -------------------------------------------------------
document.addEventListener("mousemove", (e) => {
    document.querySelectorAll(".card").forEach(card => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        card.style.setProperty("--mouse-x", `${x}px`);
        card.style.setProperty("--mouse-y", `${y}px`);
    });
});

