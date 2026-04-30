/**
 * P.R.O.T.O.N Dashboard — v2 Integration Logic
 */
(function () {
    "use strict";

    let BACKEND_URL = "http://localhost:5001";
    let incidents   = [];
    let connected   = false;
    let pollTimer   = null;
    const POLL_MS   = 5000;
    let statusFilter = "all";
    let typeFilter   = "all";
    let currentScore = 0;
    let focusedIncidentId = null; // Tracked focus for map view

    const $ = s => document.querySelector(s);
    const $$ = s => document.querySelectorAll(s);

    const dom = {
        backendUrl:       $("#backend-url"),
        connectBtn:       $("#connect-btn"),
        connectionStatus: $("#connection-status"),
        lastRefresh:      $("#last-refresh"),
        pageTitle:        $("#page-title"),
        menuToggle:       $("#menu-toggle"),
        sidebar:          $("#sidebar"),
        refreshBtn:       $("#refresh-btn"),

        statTotal:     $("#stat-total-value"),
        statActive:    $("#stat-active-value"),
        statResolved:  $("#stat-resolved-value"),
        statHighScore: $("#stat-high-score-value"),
        incidentBadge: $("#incident-count-badge"),

        gaugeArc:      $("#gauge-arc"),
        gaugeScore:    $("#gauge-score-text"),
        threatLabel:   $("#threat-label"),

        recentList:    $("#recent-list"),
        timeline:      $("#timeline"),

        incidentsTbody: $("#incidents-tbody"),
        incidentsEmpty: $("#incidents-empty"),

        mapPlaceholder: $("#map-placeholder"),
        mapIframe:      $("#map-iframe"),
        mapList:        $("#map-incidents-list"),

        modalOverlay: $("#modal-overlay"),
        modalTitle:   $("#modal-title"),
        modalBody:    $("#modal-body"),
        modalFooter:  $("#modal-footer"),
        modalClose:   $("#modal-close"),

        toastContainer: $("#toast-container"),

        // Faces
        faceName:      $("#face-name"),
        faceFile:      $("#face-file"),
        faceDropZone:  $("#panel-upload"),
        facePreview:   $("#face-preview"),
        registerBtn:   $("#register-btn"),
        registerResult:$("#register-result"),
        facesList:     $("#faces-list"),
        refreshFacesBtn: $("#refresh-faces-btn"),
    };

    // ════════════════════════════════════════════════════════
    //  CONNECTION
    // ════════════════════════════════════════════════════════
    async function connect() {
        setStatus("connecting");
        try {
            const r = await fetch(`${BACKEND_URL}/api/health`, { signal: AbortSignal.timeout(5000) });
            const d = await r.json();
            if (d.status === "online") {
                connected = true; setStatus("online");
                toast("Connected to backend", "success");
                fetchIncidents(); fetchFaces();
                if (pollTimer) clearInterval(pollTimer);
                pollTimer = setInterval(fetchIncidents, POLL_MS);
            } else throw new Error("bad health");
        } catch {
            connected = false; setStatus("error");
            toast("Cannot reach backend. Is Flask running?", "error");
        }
    }

    function setStatus(s) {
        if(!dom.connectionStatus) return;
        const dot  = dom.connectionStatus.querySelector(".status-dot");
        const text = dom.connectionStatus.querySelector(".status-text");
        if(dot && text) {
            dot.className = "inline-block w-2 h-2 rounded-full status-dot " + 
                (s === 'online' ? 'bg-secondary' : s === 'error' ? 'bg-error' : 'bg-outline');
            text.textContent = s === "online" ? "Connected" : s === "error" ? "Disconnected" : "Connecting...";
        }
    }

    // ════════════════════════════════════════════════════════
    //  FETCH INCIDENTS
    // ════════════════════════════════════════════════════════
    async function fetchIncidents() {
        if (!connected) return;
        try {
            const r = await fetch(`${BACKEND_URL}/api/incidents?limit=100`, { signal: AbortSignal.timeout(8000) });
            const d = await r.json();
            if (d.success) {
                const prev = incidents.length;
                incidents = d.incidents || [];
                if (incidents.length > prev && prev > 0)
                    toast(`${incidents.length - prev} new incident(s)!`, "warning");
                renderAll();
                if(dom.lastRefresh) dom.lastRefresh.textContent = `Updated ${new Date().toLocaleTimeString()}`;
            }
        } catch { /* silent */ }
    }

    // ════════════════════════════════════════════════════════
    //  RENDER ALL
    // ════════════════════════════════════════════════════════
    function renderAll() {
        renderStats(); renderGauge(); renderRecent();
        renderTimeline(); renderTable(); renderMap();
    }

    function renderStats() {
        const active   = incidents.filter(i => i.status === "active").length;
        const resolved = incidents.filter(i => i.status === "resolved").length;
        const max      = incidents.length ? Math.max(...incidents.map(i => i.threat_score || 0)) : 0;
        if(dom.statTotal) dom.statTotal.textContent     = incidents.length;
        if(dom.statActive) dom.statActive.textContent    = active;
        if(dom.statResolved) dom.statResolved.textContent  = resolved;
        if(dom.statHighScore) dom.statHighScore.textContent = max;
        if(dom.incidentBadge) {
            dom.incidentBadge.textContent = active;
            dom.incidentBadge.style.display = active ? "inline-block" : "none";
        }
    }

    function renderGauge() {
        if(!dom.gaugeArc) return;
        const baseScore = incidents.filter(i => i.status === "active").length
            ? Math.max(...incidents.filter(i => i.status === "active").map(i => i.threat_score || 0)) : 0;
        
        // Add subtle "Live Pulse" jitter (±0.5) to indicate active monitoring
        const jitter = (Math.random() - 0.5) * 1.2;
        const score = Math.max(0, Math.min(100, Math.round(baseScore + jitter)));
        
        currentScore = score;
        const arc = 283;
        dom.gaugeArc.style.strokeDashoffset = arc - (arc * score / 100);
        dom.gaugeScore.textContent = score;
        const labels = [[80,"CRITICAL","bg-error text-on-error"],[60,"HIGH","bg-error-container text-on-error-container"],
                        [40,"MODERATE","bg-secondary-container text-on-secondary-container"],[0,"SAFE","bg-surface-container text-outline"]];
        for (const [min, lbl, cls] of labels) {
            if (score >= min) {
                dom.threatLabel.textContent = lbl;
                dom.threatLabel.className = `text-xs mt-1 font-semibold px-2 py-1 rounded ${cls}`;
                break;
            }
        }
    }

    function scoreClass(score) {
        if (score >= 80) return "score-critical";
        if (score >= 60) return "score-high";
        if (score >= 40) return "score-moderate";
        return "score-safe";
    }

    function renderRecent() {
        if(!dom.recentList) return;
        if (!incidents.length) {
            dom.recentList.innerHTML = '<div class="text-center py-8 text-outline text-sm"><p>No incidents yet</p></div>';
            return;
        }
        dom.recentList.innerHTML = incidents.slice(0, 5).map(inc => {
            let statusClass = "bg-surface-variant text-on-surface-variant";
            if(inc.status === 'active') statusClass = "bg-error-container text-on-error-container";
            if(inc.status === 'acknowledged') statusClass = "bg-[#fff3cd] text-[#856404]";
            if(inc.status === 'resolved') statusClass = "bg-secondary-fixed text-on-secondary-fixed";
            
            let sClass = "text-on-surface";
            if(inc.threat_score >= 80) sClass = "text-error font-bold";
            else if(inc.threat_score >= 60) sClass = "text-[#856404] font-bold";
            
            return `
            <div class="bg-surface-container-lowest p-3 rounded-lg shadow-sm border border-surface-container flex flex-col gap-2 cursor-pointer hover:border-primary transition-colors interactive-card" onclick="window._openIncident('${inc.incident_id}')">
                <div class="flex justify-between items-start">
                    <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-label-sm text-[10px] ${statusClass} uppercase tracking-wider">${inc.status}</span>
                    <span class="text-[10px] text-outline">${fmtTimeShort(inc.timestamp_iso || inc.timestamp)}</span>
                </div>
                <div class="flex justify-between items-end">
                    <div>
                        <p class="font-medium text-sm text-on-surface break-words">${fmtType(inc.threat_type)}</p>
                        <p class="text-xs text-outline truncate w-40">${inc.location_str || 'Unknown'}</p>
                    </div>
                    <span class="font-bold font-mono text-lg ${sClass}">${inc.threat_score || 0}</span>
                </div>
            </div>`;
        }).join("");
    }

    function renderTimeline() {
        if(!dom.timeline) return;
        if (!incidents.length) {
            dom.timeline.innerHTML = '<div class="text-center py-8 text-outline"><p>No activity recorded</p></div>';
            return;
        }
        dom.timeline.innerHTML = incidents.slice(0, 10).map(inc => `
            <div class="flex gap-4 items-start pb-4 border-b border-surface-variant last:border-0 last:pb-0">
                <div class="w-10 h-10 rounded-full bg-surface-container flex items-center justify-center text-lg shrink-0">
                    ${typeIcon(inc.threat_type)}
                </div>
                <div class="flex-1">
                    <p class="font-medium text-sm text-on-surface">${fmtType(inc.threat_type)} <span class="text-outline font-normal">— Score ${inc.threat_score}/100</span></p>
                    <p class="text-xs text-outline mt-1">${inc.location_str || 'Unknown'} · ${fmtTime(inc.timestamp_iso || inc.timestamp)}</p>
                </div>
            </div>`).join("");
    }

    function renderTable() {
        if(!dom.incidentsTbody) return;
        let list = incidents;
        if (statusFilter !== "all") list = list.filter(i => i.status === statusFilter);
        if (typeFilter   !== "all") list = list.filter(i => i.threat_type === typeFilter);

        if (!list.length) {
            dom.incidentsTbody.innerHTML = "";
            dom.incidentsEmpty.style.display = "flex";
            return;
        }
        dom.incidentsEmpty.style.display = "none";
        dom.incidentsTbody.innerHTML = list.map(inc => {
            let statusClass = "bg-surface-variant text-on-surface-variant";
            if(inc.status === 'active') statusClass = "bg-error-container text-on-error-container";
            if(inc.status === 'acknowledged') statusClass = "bg-[#fff3cd] text-[#856404]";
            if(inc.status === 'resolved') statusClass = "bg-secondary-fixed text-on-secondary-fixed";
            
            let sClass = "text-on-surface";
            if(inc.threat_score >= 80) sClass = "text-error font-bold";
            else if(inc.threat_score >= 60) sClass = "text-[#856404] font-bold";
            
            return `
            <tr class="hover:bg-surface-container-low transition-colors">
                <td class="py-sm px-md">
                    <span class="inline-flex items-center gap-1 px-2 py-1 rounded-full font-label-md text-body-sm ${statusClass}">
                        ${inc.status}
                    </span>
                </td>
                <td class="py-sm px-md font-body-md text-on-surface flex items-center gap-1">
                    ${typeIcon(inc.threat_type)} ${fmtType(inc.threat_type)}
                </td>
                <td class="py-sm px-md font-body-md ${sClass}">${inc.threat_score || 0}/100</td>
                <td class="py-sm px-md font-body-sm text-on-surface-variant">${inc.location_str || '—'}</td>
                <td class="py-sm px-md font-body-sm text-on-surface-variant">${inc.distance_m ? inc.distance_m.toFixed(2)+'m' : '—'}</td>
                <td class="py-sm px-md font-body-sm text-on-surface-variant">${fmtTimeShort(inc.timestamp_iso || inc.timestamp)}</td>
                <td class="py-sm px-md">
                    ${inc.image_url 
                        ? `<img src="${inc.image_url.startsWith('/') ? BACKEND_URL + inc.image_url : inc.image_url}" class="w-10 h-10 object-cover rounded cursor-pointer hover:scale-110 transition-transform" onclick="window._openIncident('${inc.incident_id}')">` 
                        : `<span class="text-outline">—</span>`}
                </td>
                <td class="py-sm px-md">
                    <button class="text-primary hover:text-on-primary-fixed-variant font-label-md text-label-md" onclick="window._openIncident('${inc.incident_id}')">Review</button>
                </td>
            </tr>`;
        }).join("");
    }

    function renderMap() {
        if(!dom.mapIframe) return;
        const geo = incidents.filter(i => i.latitude && i.longitude);
        if (!geo.length) {
            dom.mapPlaceholder.style.display = "flex";
            dom.mapIframe.style.display      = "none";
            if(dom.mapList) dom.mapList.innerHTML = '<div class="p-6 text-center text-outline text-sm"><p>No GPS data yet</p></div>';
            return;
        }
        dom.mapPlaceholder.style.display = "none";
        dom.mapIframe.style.display      = "block";
        
        // Use focused incident if it exists, otherwise latest
        let c = geo.find(i => i.incident_id === focusedIncidentId) || geo[0];
        
        const newSrc = `https://maps.google.com/maps?q=${c.latitude},${c.longitude}&z=16&output=embed`;
        // Only update src if it changed to avoid flickering
        if (dom.mapIframe.getAttribute('data-src') !== newSrc) {
            dom.mapIframe.src = newSrc;
            dom.mapIframe.setAttribute('data-src', newSrc);
        }

        if(dom.mapList) {
            dom.mapList.innerHTML = geo.map(inc => {
                let sClass = "text-on-surface";
                if(inc.threat_score >= 80) sClass = "text-error font-bold";
                else if(inc.threat_score >= 60) sClass = "text-[#856404] font-bold";
                const isFocused = inc.incident_id === (focusedIncidentId || geo[0].incident_id);
                return `
                <div class="flex items-center justify-between p-3 border-b border-surface-variant last:border-0 cursor-pointer ${isFocused ? 'bg-primary-fixed/20 border-l-4 border-l-primary' : 'hover:bg-surface-container-low'} transition-colors interactive-card" onclick="window._focusIncident('${inc.incident_id}')">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-full bg-surface-container flex items-center justify-center text-lg shrink-0">${typeIcon(inc.threat_type)}</div>
                        <div>
                            <div class="font-medium text-sm text-on-surface">${fmtType(inc.threat_type)}</div>
                            <div class="text-xs text-outline">${inc.latitude?.toFixed(5)}, ${inc.longitude?.toFixed(5)}</div>
                        </div>
                    </div>
                    <span class="font-bold font-mono text-lg ${sClass}">${inc.threat_score || 0}</span>
                </div>`;
            }).join("");
        }
    }

    window._focusIncident = function(id) {
        focusedIncidentId = id;
        renderMap();
        toast("Map focused on threat location", "info");
    };

    // ════════════════════════════════════════════════════════
    //  FACE MANAGEMENT
    // ════════════════════════════════════════════════════════
    async function fetchFaces() {
        if (!connected) return;
        try {
            const r = await fetch(`${BACKEND_URL}/api/faces`);
            const d = await r.json();
            if (d.success) renderFaces(d.faces || []);
        } catch { /* silent */ }
    }

    function renderFaces(faces) {
        if (!dom.facesList) return;
        if (!faces.length) {
            dom.facesList.innerHTML = `<div class="col-span-full py-8 text-center text-outline">
                <p class="font-medium text-on-surface">No registered faces</p>
                <span class="text-sm">Register a person above to allow them access.</span></div>`;
            return;
        }
        dom.facesList.innerHTML = faces.map(f => `
            <div class="bg-surface-container-lowest border border-surface-variant rounded-xl p-4 text-center hover:border-primary/50 transition-colors">
                <div class="w-14 h-14 mx-auto rounded-full bg-primary-fixed text-primary flex items-center justify-center text-2xl mb-3 border border-primary/20">👤</div>
                <h3 class="font-semibold text-sm text-on-surface truncate">${f.name}</h3>
                <p class="text-xs text-outline mb-3">${f.photo_count} photo${f.photo_count !== 1 ? 's' : ''}</p>
                <button class="w-full py-1.5 rounded-lg bg-error/10 text-error text-xs font-medium hover:bg-error/20 transition-colors" onclick="window._deleteFace('${f.name}')">Remove</button>
            </div>`).join("");
    }

    window._deleteFace = async function(name) {
        if (!confirm(`Remove '${name}' from authorized faces?`)) return;
        try {
            const r = await fetch(`${BACKEND_URL}/api/faces/${encodeURIComponent(name)}`, { method: "DELETE" });
            const d = await r.json();
            if (d.success) { toast(`'${name}' removed`, "success"); fetchFaces(); }
            else toast(d.error || "Error", "error");
        } catch (e) { toast("Network error", "error"); }
    };

    let _cameraStream = null;
    let _snapBlob     = null;   

    window._switchPhotoTab = function(tab) {
        const btnUpload = document.getElementById("tab-upload");
        const btnCamera = document.getElementById("tab-camera");
        
        if(tab === 'upload') {
            btnUpload.className = "flex-1 py-2 px-4 rounded-lg text-sm font-medium bg-primary-fixed/30 text-primary border border-primary/30 active";
            btnCamera.className = "flex-1 py-2 px-4 rounded-lg text-sm font-medium bg-surface-container hover:bg-surface-variant text-on-surface-variant transition-colors";
            document.getElementById("panel-upload").classList.remove("hidden");
            document.getElementById("panel-camera").classList.add("hidden");
            document.getElementById("panel-camera").classList.remove("flex");
        } else {
            btnCamera.className = "flex-1 py-2 px-4 rounded-lg text-sm font-medium bg-primary-fixed/30 text-primary border border-primary/30 active";
            btnUpload.className = "flex-1 py-2 px-4 rounded-lg text-sm font-medium bg-surface-container hover:bg-surface-variant text-on-surface-variant transition-colors";
            document.getElementById("panel-camera").classList.remove("hidden");
            document.getElementById("panel-camera").classList.add("flex");
            document.getElementById("panel-upload").classList.add("hidden");
        }

        if(dom.facePreview) dom.facePreview.classList.add("hidden");
        _snapBlob = null;
        if (tab === "upload" && _cameraStream) {
            _cameraStream.getTracks().forEach(t => t.stop());
            _cameraStream = null;
        }
    };

    window._startCamera = function() {
        const video   = document.getElementById("face-video");
        const startBtn = document.getElementById("start-cam-btn");
        const snapBtn  = document.getElementById("snap-btn");
        navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false })
            .then(stream => {
                _cameraStream = stream;
                video.srcObject = stream;
                startBtn.classList.add("hidden");
                snapBtn.classList.remove("hidden");
            })
            .catch(err => {
                showResult("Camera error: " + err.message, "error");
            });
    };

    window._snapPhoto = function() {
        const video   = document.getElementById("face-video");
        const canvas  = document.getElementById("face-canvas");
        const snapBtn  = document.getElementById("snap-btn");
        const retryBtn = document.getElementById("retry-btn");
        canvas.width  = video.videoWidth  || 640;
        canvas.height = video.videoHeight || 480;
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(blob => {
            _snapBlob = blob;
            dom.facePreview.src = canvas.toDataURL("image/jpeg");
            dom.facePreview.classList.remove("hidden");
            snapBtn.classList.add("hidden");
            retryBtn.classList.remove("hidden");
            if (_cameraStream) {
                _cameraStream.getTracks().forEach(t => t.stop());
                _cameraStream = null;
            }
        }, "image/jpeg", 0.92);
    };

    window._retryCamera = function() {
        _snapBlob = null;
        dom.facePreview.classList.add("hidden");
        document.getElementById("snap-btn").classList.add("hidden");
        document.getElementById("retry-btn").classList.add("hidden");
        document.getElementById("start-cam-btn").classList.remove("hidden");
        document.getElementById("face-video").srcObject = null;
    };

    function initFaceUpload() {
        if (!dom.faceFile) return;
        dom.faceFile.addEventListener("change", () => {
            const file = dom.faceFile.files[0];
            if (file) showPreview(file);
        });
        dom.faceDropZone?.addEventListener("click", () => dom.faceFile.click());
        dom.faceDropZone?.addEventListener("dragover", e => { e.preventDefault(); dom.faceDropZone.classList.add("border-primary"); });
        dom.faceDropZone?.addEventListener("dragleave", () => dom.faceDropZone.classList.remove("border-primary"));
        dom.faceDropZone?.addEventListener("drop", e => {
            e.preventDefault();
            dom.faceDropZone.classList.remove("border-primary");
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith("image/")) { showPreview(file); dom.faceFile.files = e.dataTransfer.files; }
        });
        dom.registerBtn?.addEventListener("click", registerFace);
    }

    function showPreview(file) {
        const reader = new FileReader();
        reader.onload = e => {
            dom.facePreview.src = e.target.result;
            dom.facePreview.classList.remove("hidden");
        };
        reader.readAsDataURL(file);
    }

    async function registerFace() {
        const name = dom.faceName?.value?.trim();
        const activeTab = document.getElementById("tab-camera").classList.contains("bg-primary-fixed") ? "camera" : "upload";
        const file = activeTab === "camera" ? _snapBlob : dom.faceFile?.files[0];

        if (!name) { showResult("Please enter a name.", "error"); return; }
        if (!file)  {
            showResult(activeTab === "camera" ? "Take a snapshot first." : "Select or drop a photo.", "error");
            return;
        }

        const fd = new FormData();
        fd.append("name", name);
        fd.append("image", file, activeTab === "camera" ? "snapshot.jpg" : (dom.faceFile?.files[0]?.name || "photo.jpg"));

        dom.registerBtn.disabled = true;
        dom.registerBtn.innerHTML = "Registering...";

        try {
            const r = await fetch(`${BACKEND_URL}/api/faces/register`, { method: "POST", body: fd });
            const d = await r.json();
            if (d.success) {
                showResult(`✓ '${d.name}' registered.`, "success");
                dom.faceName.value = "";
                dom.faceFile.value = "";
                dom.facePreview.classList.add("hidden");
                _snapBlob = null;
                window._retryCamera();
                fetchFaces();
            } else {
                showResult(d.error || "Registration failed.", "error");
            }
        } catch (e) {
            showResult("Cannot reach backend.", "error");
        } finally {
            dom.registerBtn.disabled = false;
            dom.registerBtn.innerHTML = `Register Person`;
        }
    }

    function showResult(msg, type) {
        if (!dom.registerResult) return;
        dom.registerResult.textContent = msg;
        dom.registerResult.classList.remove("hidden", "text-error", "text-secondary", "bg-error/10", "bg-secondary/10");
        dom.registerResult.classList.add(type === "error" ? "text-error" : "text-secondary");
        dom.registerResult.classList.add(type === "error" ? "bg-error/10" : "bg-secondary/10");
    }

    // ════════════════════════════════════════════════════════
    //  INCIDENT ACTIONS
    // ════════════════════════════════════════════════════════
    window._openIncident = function(id) {
        const inc = incidents.find(i => i.incident_id === id);
        if (!inc) return;
        
        // Auto-focus map when opening detail
        if (inc.latitude && inc.longitude) {
            focusedIncidentId = id;
            renderMap();
        }

        dom.modalTitle.textContent = `${fmtType(inc.threat_type)} Incident`;
        
        let statusBadge = `<span class="px-2 py-1 rounded-full text-body-sm font-label-md bg-surface-variant text-on-surface-variant">${inc.status}</span>`;
        if(inc.status === 'active') statusBadge = `<span class="px-2 py-1 rounded-full text-body-sm font-label-md bg-error-container text-on-error-container">${inc.status}</span>`;
        
        dom.modalBody.innerHTML = [
            ["ID", inc.incident_id],
            ["Type", `${typeIcon(inc.threat_type)} ${fmtType(inc.threat_type)}`],
            ["Score", `${inc.threat_score}/100`],
            ["Status", statusBadge],
            ["Location", inc.location_str || "Unknown"],
            ["Time", fmtTime(inc.timestamp_iso || inc.timestamp)],
            ...(inc.maps_link ? [["Maps", `<a href="${inc.maps_link}" target="_blank" class="text-primary hover:underline">Open Maps ↗</a>`]] : []),
        ].map(([l, v]) => `<div class="modal-row"><span class="modal-label font-label-md text-on-surface-variant">${l}</span><span class="text-on-surface">${v}</span></div>`).join("")
        + (inc.image_url ? `<img src="${inc.image_url.startsWith('/') ? BACKEND_URL + inc.image_url : inc.image_url}" class="modal-evidence" alt="Evidence">` : "");

        dom.modalFooter.innerHTML = (inc.status === "active"
            ? `<button class="bg-[#fff3cd] text-[#856404] px-4 py-2 rounded-lg font-label-md hover:bg-[#ffeeba] transition-colors" onclick="window._setStatus('${inc.incident_id}','acknowledged')">Acknowledge</button>
               <button class="bg-secondary text-on-secondary px-4 py-2 rounded-lg font-label-md hover:bg-on-secondary-fixed-variant transition-colors" onclick="window._setStatus('${inc.incident_id}','resolved')">Resolve</button>`
            : inc.status === "acknowledged"
            ? `<button class="bg-secondary text-on-secondary px-4 py-2 rounded-lg font-label-md hover:bg-on-secondary-fixed-variant transition-colors" onclick="window._setStatus('${inc.incident_id}','resolved')">Resolve</button>`
            : `<span class="text-secondary font-label-md px-4 py-2">✓ Resolved</span>`);

        dom.modalOverlay.classList.add("active");
    };

    window._setStatus = async function(id, s) {
        try {
            const r = await fetch(`${BACKEND_URL}/api/incidents/${id}/status`, {
                method: "PUT", headers: {"Content-Type":"application/json"},
                body: JSON.stringify({ status: s }),
            });
            const d = await r.json();
            if (d.success) {
                const inc = incidents.find(i => i.incident_id === id);
                if (inc) inc.status = s;
                renderTable();
                renderRecent();
                dom.modalOverlay.classList.remove("active");
                toast(`Incident marked as ${s}`, "success");
            } else toast(d.error || "Failed", "error");
        } catch { toast("Network error", "error"); }
    };

    // ════════════════════════════════════════════════════════
    //  UTILITIES
    // ════════════════════════════════════════════════════════
    function typeIcon(type) {
        if (!type) return "❓";
        if (type === "fire") return "🔥";
        if (type === "glass_break") return "🪟";
        if (type === "intruder") return "🚨";
        return "⚠️";
    }

    function fmtType(type) {
        if (!type) return "Unknown";
        return type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    }

    function fmtTime(iso) {
        if (!iso) return "—";
        try {
            const d = new Date(iso), diff = Date.now() - d;
            if (isNaN(d)) return iso;
            if (diff < 60000) return "Just now";
            if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`;
            if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`;
            return d.toLocaleDateString() + " " + d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
        } catch { return iso; }
    }
    
    function fmtTimeShort(iso) {
        if (!iso) return "—";
        try {
            const d = new Date(iso), diff = Date.now() - d;
            if (isNaN(d)) return iso;
            if (diff < 60000)   return "Just now";
            if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`;
            if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`;
            return d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
        } catch { return iso; }
    }

    function toast(msg, type = "info") {
        const el = document.createElement("div");
        el.className = `toast ${type}`;
        el.innerHTML = `<span>${msg}</span>`;
        dom.toastContainer.appendChild(el);
        setTimeout(() => {
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 200);
        }, 4000);
    }
    
    // ════════════════════════════════════════════════════════
    //  VIEW SWITCHING
    // ════════════════════════════════════════════════════════
    function switchView(name) {
        $$(".nav-item").forEach(n => {
            if(n.dataset.view === name) {
                // Update active state based on nav-item styles
                n.classList.add("active", "bg-primary-fixed/30", "text-primary", "border-r-4", "border-primary");
                n.classList.remove("text-on-surface-variant");
                n.querySelector('.material-symbols-outlined')?.classList.add("icon-fill");
            } else {
                n.classList.remove("active", "bg-primary-fixed/30", "text-primary", "border-r-4", "border-primary");
                n.classList.add("text-on-surface-variant");
                n.querySelector('.material-symbols-outlined')?.classList.remove("icon-fill");
            }
        });
        $$(".view").forEach(v => {
            if(v.id === `view-${name}`) {
                v.classList.add("active");
                v.classList.remove("hidden");
            }
            else {
                v.classList.remove("active");
                v.classList.add("hidden");
            }
        });
        if (name === "faces") fetchFaces();
        
        // Hide/Show correct topbar if switching to map
        if(name === "map") {
            // Because Map is split layout we should handle map sizing
        }
    }

    // ════════════════════════════════════════════════════════
    //  INIT
    // ════════════════════════════════════════════════════════
    function init() {
        initFaceUpload();

        $$(".nav-item").forEach(n => n.addEventListener("click", e => {
            e.preventDefault(); switchView(n.dataset.view);
        }));

        dom.connectBtn?.addEventListener("click", () => {
            BACKEND_URL = dom.backendUrl.value.replace(/\/+$/, "");
            connect();
        });

        dom.refreshBtn?.addEventListener("click", fetchIncidents);
        dom.refreshFacesBtn?.addEventListener("click", fetchFaces);

        // Filters
        $$("[data-filter]").forEach(btn => btn.addEventListener("click", () => {
            $$("[data-filter]").forEach(b => {
                b.classList.remove("active", "bg-primary-fixed/30", "text-primary", "border-primary/30", "border");
                b.classList.add("bg-surface-container", "text-on-surface-variant");
            });
            btn.classList.add("active", "bg-primary-fixed/30", "text-primary", "border-primary/30", "border");
            btn.classList.remove("bg-surface-container", "text-on-surface-variant");
            statusFilter = btn.dataset.filter;
            renderTable();
        }));

        $$("[data-type]").forEach(btn => btn.addEventListener("click", () => {
            $$("[data-type]").forEach(b => {
                b.classList.remove("active", "bg-primary-fixed/30", "text-primary", "border-primary/30", "border");
                b.classList.add("bg-surface-container", "text-on-surface-variant");
            });
            btn.classList.add("active", "bg-primary-fixed/30", "text-primary", "border-primary/30", "border");
            btn.classList.remove("bg-surface-container", "text-on-surface-variant");
            typeFilter = btn.dataset.type;
            renderTable();
        }));

        dom.modalClose?.addEventListener("click", () => dom.modalOverlay.classList.remove("active"));
        dom.modalOverlay?.addEventListener("click", e => {
            if (e.target === dom.modalOverlay) dom.modalOverlay.classList.remove("active");
        });

        // Initial connection attempt if URL is present
        if(dom.backendUrl.value) connect();
        
        // Start Live Pulse for the gauge (independent of polling)
        setInterval(renderGauge, 1500);
        
        switchView("dashboard");
    }

    document.addEventListener("DOMContentLoaded", init);
})();
