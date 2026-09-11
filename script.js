// Backend API base — update these if you deploy the backend elsewhere
// (see backend/README.md, section 7).
const API_BASE = "http://localhost:5000/api";
const API_ORIGIN = "http://localhost:5000";

const form = document.getElementById("consultForm");
const result = document.getElementById("result");
const refreshBtn = document.getElementById("refreshBtn");
const languageBtn = document.getElementById("languageBtn");
const menuBtn = document.getElementById("menuBtn");

form.addEventListener("submit", function (event) {
  event.preventDefault();

  const name = document.getElementById("patientName").value.trim();
  const symptom = document.getElementById("symptom").value;
  const duration = document.getElementById("duration").value;

  result.className = "result";

  if (symptom === "Chest pain" || symptom === "Difficulty breathing") {
    result.classList.add("danger");
    result.innerHTML = `<strong>🔴 High-risk demo result</strong><br>
      ${name}, this symptom may require urgent in-person medical attention.
      Please contact local emergency services or visit the nearest emergency facility.
      <br><small>This prototype does not diagnose medical conditions.</small>`;
  } else if (duration === "More than 7 days") {
    result.classList.add("warn");
    result.innerHTML = `<strong>🟠 Moderate-risk demo result</strong><br>
      A doctor consultation is recommended for ${name}. A health worker can create a teleconsultation request and attach the patient's history.`;
  } else {
    result.classList.add("safe");
    result.innerHTML = `<strong>🟢 Teleconsultation recommended</strong><br>
      ${name}'s case can be queued for a doctor consultation in this prototype. The doctor makes the final clinical decision.`;
  }

  result.scrollIntoView({ behavior: "smooth", block: "nearest" });

  // Save the submission on the backend in the background — doesn't block
  // or change the on-screen result, which is computed locally above.
  fetch(`${API_BASE}/consultations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patientName: name, symptom, duration })
  }).catch(() => {
    // Non-fatal for this demo — the local result already shown stands
    // even if the backend is unreachable.
  });
});

refreshBtn.addEventListener("click", function () {
  const original = refreshBtn.textContent;
  refreshBtn.textContent = "✓ Updated";
  setTimeout(() => refreshBtn.textContent = original, 1200);
});

languageBtn.addEventListener("click", function () {
  alert("Language switch demo: Hindi / English\nA production version can support Marathi, Hindi, English and other regional languages.");
});

menuBtn.addEventListener("click", function () {
  const nav = document.querySelector("nav");
  nav.style.display = nav.style.display === "flex" ? "none" : "flex";
  nav.style.position = "absolute";
  nav.style.top = "76px";
  nav.style.left = "0";
  nav.style.right = "0";
  nav.style.padding = "20px 5%";
  nav.style.background = "white";
  nav.style.flexDirection = "column";
});

/* =========================================================
   1. NEAREST HOSPITAL LOCATOR (Leaflet + OpenStreetMap)
   ========================================================= */

(function hospitalLocator() {
  const form = document.getElementById("hospitalSearchForm");
  if (!form) return;

  const areaInput = document.getElementById("areaInput");
  const useLocationBtn = document.getElementById("useLocationBtn");
  const statusBox = document.getElementById("locatorStatus");
  const listBox = document.getElementById("hospitalList");
  const mapEl = document.getElementById("hospitalMap");

  let map, markersLayer;

  function initMap() {
    if (map) return;
    map = L.map(mapEl).setView([22.9734, 78.6569], 5); // India, default view
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);
    markersLayer = L.layerGroup().addTo(map);
  }

  function setStatus(message, isError) {
    statusBox.classList.remove("hidden");
    statusBox.classList.toggle("error", !!isError);
    statusBox.textContent = message;
  }

  function clearStatus() {
    statusBox.classList.add("hidden");
    statusBox.textContent = "";
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const toRad = (v) => (v * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  async function geocodeArea(query) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("geocode-failed");
    const data = await res.json();
    if (!data.length) throw new Error("not-found");
    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), label: data[0].display_name };
  }

  async function fetchNearbyHospitals(lat, lon, radiusMeters) {
    const query = `[out:json][timeout:25];(
      node["amenity"~"hospital|clinic"](around:${radiusMeters},${lat},${lon});
      way["amenity"~"hospital|clinic"](around:${radiusMeters},${lat},${lon});
    );out center 25;`;
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: query
    });
    if (!res.ok) throw new Error("overpass-failed");
    const data = await res.json();
    return data.elements
      .map((el) => {
        const elLat = el.lat || (el.center && el.center.lat);
        const elLon = el.lon || (el.center && el.center.lon);
        if (!elLat || !elLon) return null;
        const tags = el.tags || {};
        return {
          name: tags.name || (tags.amenity === "clinic" ? "Unnamed Clinic" : "Unnamed Hospital"),
          type: tags.amenity,
          lat: elLat,
          lon: elLon,
          address: [tags["addr:street"], tags["addr:city"] || tags["addr:town"]].filter(Boolean).join(", "),
          distance: haversineKm(lat, lon, elLat, elLon)
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 15);
  }

  function renderResults(center, hospitals) {
    markersLayer.clearLayers();

    L.marker([center.lat, center.lon], { title: "Search location" })
      .addTo(markersLayer)
      .bindPopup("<strong>Your search location</strong>");

    if (!hospitals.length) {
      listBox.innerHTML = `<p class="locator-empty">No hospitals or clinics found within range on OpenStreetMap data for this area. Try a nearby town name.</p>`;
      map.setView([center.lat, center.lon], 12);
      return;
    }

    const bounds = [[center.lat, center.lon]];
    listBox.innerHTML = hospitals
      .map((h, i) => {
        bounds.push([h.lat, h.lon]);
        const gmaps = `https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lon}`;
        return `
          <div class="hospital-item">
            <h4>${i + 1}. ${h.name}</h4>
            <p>${h.address || (h.type === "clinic" ? "Clinic" : "Hospital")}</p>
            <span class="distance">${h.distance.toFixed(1)} km away</span>
            &nbsp;·&nbsp;
            <a href="${gmaps}" target="_blank" rel="noopener">Get directions →</a>
          </div>`;
      })
      .join("");

    hospitals.forEach((h, i) => {
      L.marker([h.lat, h.lon])
        .addTo(markersLayer)
        .bindPopup(`<strong>${i + 1}. ${h.name}</strong><br>${h.distance.toFixed(1)} km away`);
    });

    map.fitBounds(bounds, { padding: [30, 30] });
  }

  async function runSearch(query, coordsOverride) {
    initMap();
    listBox.innerHTML = "";
    setStatus("Searching for hospitals near you…");
    try {
      const center = coordsOverride || (await geocodeArea(query));
      const hospitals = await fetchNearbyHospitals(center.lat, center.lon, 10000);
      clearStatus();
      renderResults(center, hospitals);
    } catch (err) {
      setStatus(
        err.message === "not-found"
          ? "Couldn't find that place. Try adding a district or state name."
          : "Something went wrong reaching the map service. Please try again.",
        true
      );
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const query = areaInput.value.trim();
    if (query) runSearch(query);
  });

  useLocationBtn.addEventListener("click", () => {
    if (!navigator.geolocation) {
      setStatus("Location access isn't supported on this device/browser.", true);
      return;
    }
    initMap();
    setStatus("Getting your location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => runSearch(null, { lat: pos.coords.latitude, lon: pos.coords.longitude, label: "Your location" }),
      () => setStatus("Couldn't access your location. Please allow location access or search by area name.", true)
    );
  });
})();

/* =========================================================
   2. DIGITAL HEALTH RECORD — CAMERA-TO-PDF VAULT (backend API)
   ========================================================= */

(function healthRecordsVault() {
  const cameraZone = document.getElementById("cameraZone");
  if (!cameraZone) return;

  const cameraInput = document.getElementById("cameraInput");
  const galleryInput = document.getElementById("galleryInput");
  const recordsList = document.getElementById("recordsList");
  const MAX_SIZE = 8 * 1024 * 1024; // 8 MB

  async function fetchRecords() {
    const res = await fetch(`${API_BASE}/records`);
    if (!res.ok) throw new Error("Couldn't load records from the server.");
    return res.json();
  }

  async function deleteRecord(id) {
    const res = await fetch(`${API_BASE}/records/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Couldn't delete that record.");
  }

  function formatSize(bytes) {
    return bytes > 1024 * 1024 ? (bytes / (1024 * 1024)).toFixed(1) + " MB" : (bytes / 1024).toFixed(0) + " KB";
  }

  async function render() {
    let records;
    try {
      records = await fetchRecords();
    } catch (err) {
      recordsList.innerHTML = `<p class="locator-empty">Couldn't reach the server. Make sure the backend is running.</p>`;
      return;
    }

    if (!records.length) {
      recordsList.innerHTML = `<p class="locator-empty" id="recordsEmpty">No documents added yet.</p>`;
      return;
    }

    recordsList.innerHTML = records
      .map(
        (r) => `
        <div class="record-item" data-id="${r.id}">
          <div class="record-icon">📄</div>
          <div class="record-info">
            <strong>${r.name}</strong>
            <small>${formatSize(r.size)} · Added ${r.date}</small>
          </div>
          <div class="record-actions">
            <a href="${API_ORIGIN}${r.url}" target="_blank" rel="noopener" download="${r.name}">View</a>
            <button type="button" class="delete-btn" data-id="${r.id}">Delete</button>
          </div>
        </div>`
      )
      .join("");
  }

  function readImageAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  // Converts a captured/chosen photo into a single-page PDF, entirely in-browser.
  async function imageFileToPdf(file) {
    const dataUrl = await readImageAsDataURL(file);
    const img = await loadImage(dataUrl);

    const { jsPDF } = window.jspdf;
    const orientation = img.width >= img.height ? "landscape" : "portrait";
    const pdf = new jsPDF({ orientation, unit: "pt", format: "a4" });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 24;
    const maxW = pageWidth - margin * 2;
    const maxH = pageHeight - margin * 2;
    const scale = Math.min(maxW / img.width, maxH / img.height);
    const drawW = img.width * scale;
    const drawH = img.height * scale;
    const x = (pageWidth - drawW) / 2;
    const y = (pageHeight - drawH) / 2;

    const format = file.type === "image/png" ? "PNG" : "JPEG";
    pdf.addImage(dataUrl, format, x, y, drawW, drawH);

    return pdf.output("blob");
  }

  async function addImageFile(file) {
    if (!file.type.startsWith("image/")) {
      alert("Please capture or choose a photo (image file) of the document.");
      return;
    }
    if (file.size > MAX_SIZE) {
      alert("Photo is larger than 8 MB. Please try a smaller image for this demo.");
      return;
    }

    try {
      const pdfBlob = await imageFileToPdf(file);
      const baseName = file.name ? file.name.replace(/\.[^/.]+$/, "") : "Scanned document";
      const displayName = `${baseName || "Scanned document"}.pdf`;

      const formData = new FormData();
      formData.append("file", pdfBlob, displayName);
      formData.append("name", displayName);

      const res = await fetch(`${API_BASE}/records`, { method: "POST", body: formData });
      if (!res.ok) throw new Error("Upload failed");

      await render();
    } catch (err) {
      alert("Couldn't save that document. Make sure the backend is running and try again.");
    }
  }

  cameraInput.addEventListener("change", () => {
    Array.from(cameraInput.files).forEach(addImageFile);
    cameraInput.value = "";
  });

  galleryInput.addEventListener("change", () => {
    Array.from(galleryInput.files).forEach(addImageFile);
    galleryInput.value = "";
  });

  recordsList.addEventListener("click", async (e) => {
    if (e.target.classList.contains("delete-btn")) {
      const id = e.target.dataset.id;
      try {
        await deleteRecord(id);
        await render();
      } catch (err) {
        alert("Couldn't delete that record. Please try again.");
      }
    }
  });

  render();
})();

/* =========================================================
   3. HEALTH ASSISTANT — DEMO SYMPTOM CHATBOT
   ========================================================= */

(function healthAssistant() {
  const chatForm = document.getElementById("chatForm");
  if (!chatForm) return;

  const chatInput = document.getElementById("chatInput");
  const chatWindow = document.getElementById("chatWindow");
  const chatChips = document.getElementById("chatChips");

  // Indicative demo data only — general OTC categories, no dosage or combination guidance.
  const KNOWLEDGE_BASE = [
    {
      keywords: ["chest pain", "difficulty breathing", "breathless", "can't breathe"],
      risk: "high",
      advice:
        "This can be a medical emergency. Please contact local emergency services or go to the nearest emergency facility right away — don't wait for a teleconsultation.",
      meds: []
    },
    {
      keywords: ["fever", "temperature"],
      risk: "medium",
      advice: "Rest, stay hydrated, and monitor temperature. See a doctor if fever crosses 3 days or is very high.",
      meds: [
        { name: "Paracetamol tablets (fever/pain relief)", price: "₹10–₹25 / strip of 10" },
        { name: "ORS sachets (hydration support)", price: "₹15–₹20 / sachet" }
      ]
    },
    {
      keywords: ["cough", "cold", "sneeze", "runny nose"],
      risk: "low",
      advice: "Steam inhalation and warm fluids often help. See a health worker if it lasts more than a week.",
      meds: [
        { name: "Cough syrup (symptomatic relief)", price: "₹60–₹120 / bottle" },
        { name: "Antihistamine tablets (sneezing/runny nose)", price: "₹15–₹30 / strip" }
      ]
    },
    {
      keywords: ["headache", "migraine"],
      risk: "low",
      advice: "Rest in a quiet, dim space and stay hydrated. Frequent or severe headaches need a doctor's review.",
      meds: [{ name: "Paracetamol tablets (pain relief)", price: "₹10–₹25 / strip of 10" }]
    },
    {
      keywords: ["stomach", "abdomen", "diarrhea", "loose motion", "vomit"],
      risk: "medium",
      advice: "Keep fluids up to avoid dehydration. Seek care quickly for infants, elderly patients, or blood in stool.",
      meds: [
        { name: "ORS sachets (rehydration)", price: "₹15–₹20 / sachet" },
        { name: "Antacid tablets/syrup (acidity)", price: "₹20–₹80" }
      ]
    },
    {
      keywords: ["body ache", "muscle pain", "joint pain"],
      risk: "low",
      advice: "Rest the affected area and stay hydrated. Persistent pain should be checked by a doctor.",
      meds: [
        { name: "Paracetamol tablets (pain relief)", price: "₹10–₹25 / strip of 10" },
        { name: "Topical pain relief gel", price: "₹40–₹90 / tube" }
      ]
    },
    {
      keywords: ["sore throat", "throat pain"],
      risk: "low",
      advice: "Warm salt-water gargles a few times a day can help soothe the throat.",
      meds: [{ name: "Throat lozenges", price: "₹30–₹60 / pack" }]
    }
  ];

  const FALLBACK = {
    risk: "low",
    advice:
      "Thanks for sharing that. A frontline health worker or doctor consultation can look into this properly — you can start one from the consultation section above.",
    meds: []
  };

  function addMessage(role, html) {
    const wrap = document.createElement("div");
    wrap.className = `chat-msg ${role}`;
    wrap.innerHTML = role === "user" ? `<p>${html}</p>` : html;
    chatWindow.appendChild(wrap);
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }

  function buildBotReply(entry) {
    const riskClass = entry.risk === "high" ? "risk-high" : entry.risk === "medium" ? "risk-medium" : "";
    const medsHtml = entry.meds.length
      ? `<div class="med-list">${entry.meds
          .map((m) => `<div class="med-row"><span>${m.name}</span><span>${m.price}</span></div>`)
          .join("")}</div>`
      : "";
    return `<div class="bubble ${riskClass}"><p style="margin:0">${entry.advice}</p>${medsHtml}</div>`;
  }

  function respondTo(text) {
    const lower = text.toLowerCase();
    const match = KNOWLEDGE_BASE.find((entry) => entry.keywords.some((k) => lower.includes(k)));
    const entry = match || FALLBACK;
    addMessage("user", text);
    setTimeout(() => addMessage("bot", buildBotReply(entry)), 350);
  }

  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    respondTo(text);
    chatInput.value = "";
  });

  chatChips.addEventListener("click", (e) => {
    if (e.target.classList.contains("chip")) {
      respondTo(e.target.textContent);
    }
  });
})();

/* =========================================================
   4. REFERRAL TRACKING (demo lookup)
   ========================================================= */

(function referralTracking() {
  const form = document.getElementById("referralForm");
  if (!form) return;

  const input = document.getElementById("referralInput");
  const resultBox = document.getElementById("referralResult");

  const STAGES = [
    "Referral Created",
    "Accepted by Facility",
    "Patient Travelling",
    "Consultation in Progress",
    "Closed / Follow-up Done"
  ];

  const REFERRALS = {
    "REF-1042": {
      patient: "Meera Devi",
      from: "PHC Bhikiwind",
      to: "District Hospital, Tarn Taran",
      stage: 3,
      notes: "Referred for suspected high-risk pregnancy. Ambulance arranged; consultation in progress at district facility."
    },
    "REF-2078": {
      patient: "Ram Lal",
      from: "Sub-Centre Sarurpur",
      to: "CHC Sarurpur Khurd",
      stage: 1,
      notes: "Referred for evaluation of persistent cough. Facility has accepted the referral; travel pending."
    },
    "REF-3390": {
      patient: "Anjali Kumari",
      from: "PHC Bhikiwind",
      to: "District Hospital, Tarn Taran",
      stage: 4,
      notes: "Fracture case treated and discharged. Follow-up X-ray completed and recorded."
    }
  };

  function renderReferral(id, ref) {
    const isClosed = ref.stage === STAGES.length - 1;
    resultBox.classList.remove("hidden", "not-found");
    resultBox.innerHTML = `
      <div class="referral-head">
        <div>
          <h3>${id} · ${ref.patient}</h3>
          <p>${ref.from} → ${ref.to}</p>
        </div>
        <span class="referral-tag ${isClosed ? "closed" : "in-progress"}">${isClosed ? "Closed" : "In progress"}</span>
      </div>
      <div class="referral-steps">
        ${STAGES.map((label, i) => {
          const state = i < ref.stage ? "done" : i === ref.stage ? "current" : "";
          return `
            <div class="referral-step ${state}">
              <div class="referral-line"></div>
              <b>${i + 1}</b>
              <span>${label}</span>
            </div>`;
        }).join("")}
      </div>
      <div class="referral-notes"><strong>Latest update:</strong> ${ref.notes}</div>
    `;
  }

  function renderNotFound(id) {
    resultBox.classList.remove("hidden");
    resultBox.classList.add("not-found");
    resultBox.innerHTML = `No referral found for "${id}" in this demo dataset. Try REF-1042, REF-2078 or REF-3390.`;
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const id = input.value.trim().toUpperCase();
    if (!id) return;
    const ref = REFERRALS[id];
    if (ref) renderReferral(id, ref);
    else renderNotFound(id);
  });
})();
