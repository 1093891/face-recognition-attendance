// frontend/app.js

// Global variables for DOM elements
// These will be assigned INSIDE DOMContentLoaded to ensure elements exist
let video;
let canvas;
let nameInput;
let registerBtn;
let markAttendanceBtn;
let messageBox;
let registeredFacesList;
let attendanceLogList;
let loadingOverlay;
let loadingText;
let systemStatus;
let timeRangeInput; // Input for auto-mark time range
let setTimeRangeBtn; // Button to set auto-mark time range

// New elements for Attendance Report
let classDateInput;
let classStartTimeInput;
let classEndTimeInput;
let reportIntervalInput;
let generateReportBtn;
let attendanceReportTableContainer;


// Backend API base URL
const API_BASE_URL = 'https://your-backend-service-name.onrender.com';

let labeledFaceDescriptors = []; // Array to store all registered LabeledFaceDescriptors
let detectionInterval; // To hold the interval ID for face detection

// --- Auto-marking specific variables ---
const DEFAULT_COOLDOWN_INTERVAL = 10000; // Default 10 seconds in milliseconds
let currentCooldownInterval = DEFAULT_COOLDOWN_INTERVAL; // Will hold the active cooldown
const recentlyMarked = {}; // Stores { 'PersonName': lastMarkedTimestamp } to prevent rapid re-marking

// --- UI Utility Functions ---
function showMessage(message, type = "info") {
    messageBox.textContent = message;
    messageBox.className = `message-box show ${type}`;
    // Automatically hide after 5 seconds
    setTimeout(() => {
        messageBox.classList.remove('show');
    }, 5000);
}

function showLoading(text = "Loading...") {
    loadingText.textContent = text;
    loadingOverlay.style.display = 'flex';
}

function hideLoading() {
    loadingOverlay.style.display = 'none';
}

function updateSystemStatus(message, type = "info") {
    systemStatus.textContent = `System Status: ${message}`;
    systemStatus.className = `status-message ${type === "error" ? "error-status" : ""}`;
}

// --- Webcam and Face-API.js Functions ---
async function startVideo() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = stream;
        video.addEventListener('loadeddata', () => {
            // Set canvas dimensions to match video
            const displaySize = { width: video.videoWidth, height: video.videoHeight };
            faceapi.matchDimensions(canvas, displaySize);
            hideLoading(); // Hide loading once video is ready
            updateSystemStatus("Webcam ready. Waiting for models...");
        });
    } catch (err) {
        console.error('Error accessing webcam:', err);
        showMessage("Error: Could not access webcam. Please allow camera permissions.", "error");
        hideLoading();
        updateSystemStatus("Webcam access denied or error.", "error");
    }
}

async function loadModels() {
    showLoading("Loading face recognition models...");
    try {
        await Promise.all([
            faceapi.nets.ssdMobilenetv1.loadFromUri('/models'),
            faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
            faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
        ]);
        console.log('Face-API.js models loaded!');
        updateSystemStatus("Models loaded. Ready for use.");
    } catch (error) {
        console.error('Error loading models:', error);
        showMessage("Error: Failed to load face recognition models. Ensure 'models' folder is in 'frontend' directory and models are downloaded.", "error");
        updateSystemStatus("Error loading models.", "error");
    }
}

async function registerFace() {
    const name = nameInput.value.trim();
    if (!name) {
        showMessage("Please enter a name to register.", "error");
        return;
    }

    showLoading(`Registering ${name}...`);
    try {
        const detections = await faceapi.detectSingleFace(video, new faceapi.SsdMobilenetv1Options())
            .withFaceLandmarks()
            .withFaceDescriptor();

        if (!detections) {
            showMessage("No face detected. Please ensure your face is clearly visible.", "error");
            hideLoading();
            return;
        }

        // Send the descriptor to the backend
        const response = await fetch(`${API_BASE_URL}/register-face`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: name,
                descriptor: Array.from(detections.descriptor) // Convert Float32Array to array
            })
        });

        const result = await response.json();
        if (response.ok) {
            showMessage(`Face registered for ${name}!`, "success");
            nameInput.value = ''; // Clear input
            fetchRegisteredFaces(); // Refresh the list
        } else {
            showMessage(`Error registering face: ${result.error}`, "error");
        }
    } catch (error) {
        console.error("Error registering face:", error);
        showMessage("Network error or server issue during registration. Please try again.", "error");
    } finally {
        hideLoading();
    }
}

// markAttendance function (for manual button click)
async function markAttendance() {
    if (!labeledFaceDescriptors || labeledFaceDescriptors.length === 0) {
        showMessage("No faces registered yet. Please register some faces first.", "info");
        return;
    }

    showLoading("Marking attendance manually...");
    try {
        const detections = await faceapi.detectSingleFace(video, new faceapi.SsdMobilenetv1Options())
            .withFaceLandmarks()
            .withFaceDescriptor();

        if (!detections) {
            showMessage("No face detected. Please ensure your face is clearly visible.", "error");
            hideLoading();
            return;
        }

        const faceMatcher = new faceapi.FaceMatcher(labeledFaceDescriptors, 0.6); // 0.6 is a common threshold for similarity
        const bestMatch = faceMatcher.findBestMatch(detections.descriptor);

        const recognizedName = bestMatch.label;
        const distance = Math.round(bestMatch.distance * 100) / 100;

        if (recognizedName !== 'unknown') {
            await markAttendanceAutomatic(recognizedName, distance, true); // Call automatic function, indicate manual trigger
            showMessage(`Attendance marked manually for ${recognizedName}! Distance: ${distance}`, "success");
        } else {
            showMessage(`Unknown person detected. Distance: ${distance}. Please register your face.`, "error");
        }
    } catch (error) {
        console.error("Error marking attendance:", error);
        showMessage("Error marking attendance. Please try again.", "error");
    } finally {
        hideLoading();
    }
}

// --- NEW FUNCTION for Automatic Attendance Marking ---
async function markAttendanceAutomatic(name, distance, isManual = false) {
    try {
        const response = await fetch(`${API_BASE_URL}/mark-attendance`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: name,
                distance: distance
            })
        });

        const result = await response.json();
        if (response.ok) {
            console.log(`${isManual ? 'MANUAL' : 'AUTO'} MARKED: ${name}, Distance: ${distance}`);
            // Only show success message for auto-marking briefly if it's the first mark within cooldown
            if (!isManual) {
                // If the user isn't actively looking at the screen, a brief message is fine.
                // Or you could update a dedicated "Last marked" display.
                showMessage(`Auto-marked: ${name}!`, "success");
            }
            fetchAttendanceLog(); // Refresh log
        } else {
            console.error(`Auto Mark Error for ${name}: ${result.error}`);
            if (isManual) showMessage(`Marking failed for ${name}: ${result.error}`, "error");
        }
    } catch (error) {
        console.error(`Auto Mark Network Error for ${name}:`, error);
        if (isManual) showMessage(`Network issue for marking: ${name}`, "error");
    }
}

function startDetectionLoop() {
    // Clear any existing interval to prevent multiple loops
    if (detectionInterval) {
        clearInterval(detectionInterval);
    }

    // Ensure video is loaded before getting its dimensions
    if (video.readyState < video.HAVE_METADATA) {
        video.addEventListener('loadedmetadata', () => {
            const displaySize = { width: video.videoWidth, height: video.videoHeight };
            faceapi.matchDimensions(canvas, displaySize);
            startDetectionLoopInternal(displaySize); // Start the internal loop once metadata is loaded
        }, { once: true }); // Use { once: true } to remove listener after first run
    } else {
        const displaySize = { width: video.videoWidth, height: video.videoHeight };
        faceapi.matchDimensions(canvas, displaySize);
        startDetectionLoopInternal(displaySize);
    }
}

function startDetectionLoopInternal(displaySize) {
    detectionInterval = setInterval(async () => {
        if (!video.srcObject || video.paused || video.ended) return; // Ensure video is playing

        const detections = await faceapi.detectAllFaces(video, new faceapi.SsdMobilenetv1Options())
            .withFaceLandmarks()
            .withFaceDescriptors();

        const resizedDetections = faceapi.resizeResults(detections, displaySize);
        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);

        faceapi.draw.drawDetections(canvas, resizedDetections);
        faceapi.draw.drawFaceLandmarks(canvas, resizedDetections); // Corrected typo here

        if (labeledFaceDescriptors && labeledFaceDescriptors.length > 0) {
            const faceMatcher = new faceapi.FaceMatcher(labeledFaceDescriptors, 0.6); // 0.6 is a common threshold

            resizedDetections.forEach(detection => {
                const bestMatch = faceMatcher.findBestMatch(detection.descriptor);
                const label = bestMatch.label;
                const distance = Math.round(bestMatch.distance * 100) / 100;

                const currentTime = Date.now();

                // Determine color for bounding box based on recognition status and cooldown
                let boxColor = 'red'; // Default to unknown/not marked
                let boxLabel = `${label} (${distance})`;

                // Use currentCooldownInterval for the check
                if (label !== 'unknown' && distance < 0.6) { // It's a recognized person and a good match
                    boxColor = 'green'; // Recognized color

                    const lastMarkedTime = recentlyMarked[label] || 0;
                    if (currentTime - lastMarkedTime > currentCooldownInterval) { // Use currentCooldownInterval
                        // This person is recognized and is outside their cooldown period
                        markAttendanceAutomatic(label, distance); // Trigger automatic marking
                        recentlyMarked[label] = currentTime; // Update cooldown timestamp
                        boxColor = 'blue'; // Indicate recently marked for a brief moment
                        boxLabel = `${label} (MARKED!)`;
                    } else {
                        // Recognized, but still in cooldown
                        boxColor = 'orange'; // Indicate recognized but on cooldown
                        boxLabel = `${label} (on cooldown)`;
                    }
                }

                // Draw bounding box and label
                const box = detection.detection.box;
                const drawBox = new faceapi.draw.DrawBox(box, { label: boxLabel, boxColor: boxColor, lineWidth: 2 });
                drawBox.draw(canvas);
            });
        }
    }, 100); // Run detection every 100ms
}


// --- Backend Data Fetching and UI Rendering ---
async function fetchRegisteredFaces() {
    try {
        const response = await fetch(`${API_BASE_URL}/registered-faces`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const faces = await response.json();

        registeredFacesList.innerHTML = ''; // Clear current list
        if (faces.length === 0) {
            registeredFacesList.innerHTML = '<p class="empty-message">No faces registered yet.</p>';
        } else {
            const tempLabeledDescriptors = [];
            faces.forEach((face) => {
                const name = face.name;
                const descriptorArray = face.descriptor;

                if (name && descriptorArray) {
                    // Convert array back to Float32Array for face-api.js
                    const descriptor = new Float32Array(descriptorArray);
                    tempLabeledDescriptors.push(new faceapi.LabeledFaceDescriptors(name, [descriptor]));

                    const listItem = document.createElement('div');
                    listItem.className = 'list-item';
                    listItem.innerHTML = `
                        <span>${name}</span>
                        <button class="delete-btn btn danger" data-name="${name}">Delete</button>
                    `;
                    registeredFacesList.appendChild(listItem);
                }
            });
            labeledFaceDescriptors = tempLabeledDescriptors; // Update global descriptors
            console.log("Registered faces updated:", labeledFaceDescriptors.map(d => d.label));
            startDetectionLoop(); // Restart detection loop to use updated descriptors
        }
    } catch (error) {
        console.error("Error fetching registered faces:", error);
        showMessage("Error loading registered faces from server.", "error");
    }
}

async function fetchAttendanceLog() {
    try {
        const response = await fetch(`${API_BASE_URL}/attendance-log`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const log = await response.json();

        attendanceLogList.innerHTML = ''; // Clear current list
        if (log.length === 0) {
            attendanceLogList.innerHTML = '<p class="empty-message">No attendance records yet.</p>';
        } else {
            log.forEach((record) => {
                const name = record.name;
                const timestamp = new Date(record.timestamp).toLocaleString();

                const listItem = document.createElement('div');
                listItem.className = 'list-item';
                listItem.innerHTML = `
                    <span>${name} - ${timestamp}</span>
                `;
                attendanceLogList.appendChild(listItem);
            });
        }
    } catch (error) {
        console.error("Error fetching attendance log:", error);
        showMessage("Error loading attendance log from server.", "error");
    }
}

// --- NEW FUNCTION: Set Attendance Interval ---
function setAttendanceInterval() {
    const intervalSeconds = parseInt(timeRangeInput.value);
    if (isNaN(intervalSeconds) || intervalSeconds <= 0) {
        showMessage("Please enter a valid positive number for the time range (in seconds).", "error");
        return;
    }
    currentCooldownInterval = intervalSeconds * 1000; // Convert seconds to milliseconds
    showMessage(`Automatic marking interval set to ${intervalSeconds} seconds.`, "info");
    // Restart the detection loop to apply the new interval immediately
    startDetectionLoop();
}

// --- NEW FUNCTION: Generate Attendance Report ---
async function generateAttendanceReport() {
    const classDate = classDateInput.value;
    const classStartTime = classStartTimeInput.value;
    const classEndTime = classEndTimeInput.value;
    const reportIntervalMinutes = parseInt(reportIntervalInput.value);

    if (!classDate || !classStartTime || !classEndTime || isNaN(reportIntervalMinutes) || reportIntervalMinutes <= 0) {
        showMessage("Please fill in all class details (Date, Start Time, End Time) and a valid positive Check Interval.", "error");
        return;
    }

    showLoading("Generating attendance report...");
    try {
        // Construct full Date objects for the class range
        const startDateTime = new Date(`${classDate}T${classStartTime}:00`);
        const endDateTime = new Date(`${classDate}T${classEndTime}:00`);

        if (startDateTime.toString() === "Invalid Date" || endDateTime.toString() === "Invalid Date" || startDateTime >= endDateTime) {
            showMessage("Invalid class date/time range. Please ensure start time is before end time.", "error");
            hideLoading();
            return;
        }

        // Fetch ALL attendance records (or records within a broader range if needed for large datasets)
        // For simplicity, we'll fetch all and filter client-side.
        // In a very large system, you'd add date range filters to the backend API.
        const response = await fetch(`${API_BASE_URL}/attendance-log`); // Fetch all records
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const allAttendanceRecords = await response.json();

        // Calculate total possible slots for the class
        const totalClassDurationMs = endDateTime.getTime() - startDateTime.getTime();
        const totalPossibleSlots = Math.floor(totalClassDurationMs / (reportIntervalMinutes * 60 * 1000));

        if (totalPossibleSlots <= 0) {
            showMessage("Class duration is too short or check interval is too large for meaningful percentage calculation.", "error");
            hideLoading();
            return;
        }

        // Process records to determine attendance slots for each person
        const personAttendanceSlots = {}; // { 'PersonName': Set<slotIndex> }

        allAttendanceRecords.forEach(record => {
            const recordDateTime = new Date(record.timestamp); // Convert record timestamp to Date object

            // Check if record falls within the class time range
            if (recordDateTime >= startDateTime && recordDateTime < endDateTime) {
                if (!personAttendanceSlots[record.name]) {
                    personAttendanceSlots[record.name] = new Set();
                }
                const offsetMs = recordDateTime.getTime() - startDateTime.getTime();
                const slotIndex = Math.floor(offsetMs / (reportIntervalMinutes * 60 * 1000));
                personAttendanceSlots[record.name].add(slotIndex);
            }
        });

        // Generate report data
        const reportData = [];
        const registeredNames = labeledFaceDescriptors.map(desc => desc.label); // Get all registered names

        // Include all registered persons, even if they have 0 attendance
        registeredNames.forEach(name => {
            const markedSlots = personAttendanceSlots[name] ? personAttendanceSlots[name].size : 0;
            const percentage = (markedSlots / totalPossibleSlots) * 100;
            reportData.push({
                name: name,
                markedSlots: markedSlots,
                totalPossibleSlots: totalPossibleSlots,
                percentage: percentage.toFixed(2) // Format to 2 decimal places
            });
        });

        // Sort report data by percentage (descending)
        reportData.sort((a, b) => b.percentage - a.percentage);

        // Render the table
        renderAttendanceReportTable(reportData);
        showMessage("Attendance report generated successfully!", "success");

    } catch (error) {
        console.error("Error generating attendance report:", error);
        showMessage("Error generating attendance report. Please check input and try again.", "error");
    } finally {
        hideLoading();
    }
}

// --- NEW FUNCTION: Render Attendance Report Table ---
function renderAttendanceReportTable(data) {
    if (data.length === 0) {
        attendanceReportTableContainer.innerHTML = '<p class="empty-message">No attendance data for the specified class time.</p>';
        return;
    }

    let tableHTML = `
        <table class="attendance-report-table">
            <thead>
                <tr>
                    <th>Person Name</th>
                    <th>Marked Slots</th>
                    <th>Total Possible Slots</th>
                    <th>Attendance (%)</th>
                </tr>
            </thead>
            <tbody>
    `;

    data.forEach(row => {
        tableHTML += `
            <tr>
                <td>${row.name}</td>
                <td>${row.markedSlots}</td>
                <td>${row.totalPossibleSlots}</td>
                <td>${row.percentage}%</td>
            </tr>
        `;
    });

    tableHTML += `
            </tbody>
        </table>
    `;
    attendanceReportTableContainer.innerHTML = tableHTML;
}


// --- Initialization ---
// This function runs when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', async () => {
    // Assign DOM elements HERE, inside DOMContentLoaded
    video = document.getElementById('video');
    canvas = document.getElementById('canvas');
    nameInput = document.getElementById('nameInput');
    registerBtn = document.getElementById('registerBtn');
    markAttendanceBtn = document.getElementById('markAttendanceBtn');
    messageBox = document.getElementById('messageBox');
    registeredFacesList = document.getElementById('registeredFacesList');
    attendanceLogList = document.getElementById('attendanceLogList');
    loadingOverlay = document.getElementById('loadingOverlay');
    loadingText = document.getElementById('loadingText');
    timeRangeInput = document.getElementById('timeRangeInput');
    setTimeRangeBtn = document.getElementById('setTimeRangeBtn');
    systemStatus = document.getElementById('systemStatus');

    // New elements for Attendance Report
    classDateInput = document.getElementById('classDate');
    classStartTimeInput = document.getElementById('classStartTime');
    classEndTimeInput = document.getElementById('classEndTime');
    reportIntervalInput = document.getElementById('reportInterval');
    generateReportBtn = document.getElementById('generateReportBtn');
    attendanceReportTableContainer = document.getElementById('attendanceReportTable');

    // Set today's date as default for classDateInput
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
    const dd = String(today.getDate()).padStart(2, '0');
    classDateInput.value = `${yyyy}-${mm}-${dd}`;


    // Attach Event Listeners HERE
    if (registerBtn) registerBtn.addEventListener('click', registerFace);
    if (markAttendanceBtn) markAttendanceBtn.addEventListener('click', markAttendance);
    if (setTimeRangeBtn) setTimeRangeBtn.addEventListener('click', setAttendanceInterval);
    if (generateReportBtn) generateReportBtn.addEventListener('click', generateAttendanceReport); // New: Event listener for report button

    // Handle delete button clicks for registered faces
    if (registeredFacesList) {
        registeredFacesList.addEventListener('click', async (event) => {
            if (event.target.classList.contains('delete-btn')) {
                const nameToDelete = event.target.dataset.name;
                if (confirm(`Are you sure you want to delete ${nameToDelete}'s registered face?`)) {
                    showLoading(`Deleting ${nameToDelete}...`);
                    try {
                        const response = await fetch(`${API_BASE_URL}/registered-faces/${nameToDelete}`, {
                            method: 'DELETE'
                        });
                        const result = await response.json();
                        if (response.ok) {
                            showMessage(`Face for ${nameToDelete} deleted successfully.`, "success");
                            fetchRegisteredFaces();
                        } else {
                            showMessage(`Error deleting face: ${result.error}`, "error");
                        }
                    } catch (error) {
                        console.error("Error deleting face:", error);
                        showMessage(`Network error or server issue during deletion.`, "error");
                    } finally {
                        hideLoading();
                    }
                }
            }
        });
    }


    showLoading("Starting webcam and loading models...");
    await loadModels(); // Load models first
    await startVideo(); // Then start video
    fetchRegisteredFaces(); // Fetch initial registered faces
    fetchAttendanceLog(); // Fetch initial attendance log
});
