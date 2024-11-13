"use strict";

window.addEventListener("DOMContentLoaded", () => {
	const elems = {};
	document.querySelectorAll("[id]").forEach((e) => elems[e.id] = e);

	const STORAGE_KEY_PREFIX = "detect_color_e2b503b7-4df2-405b-aeeb-467ae8946e8a_";

	const readLocalStorage = (key) => {
		try {
			return localStorage.getItem(STORAGE_KEY_PREFIX + key);
		} catch (e) {
			console.warn(e);
			return null;
		}
	};

	const writeLocalStorage = (key, value) => {
		try {
			localStorage.setItem(STORAGE_KEY_PREFIX + key, value);
		} catch (e) {
			console.warn(e);
		}
	};

	const savedTargetColor = readLocalStorage("targetColor");
	if (savedTargetColor !== null) elems.targetColor.value = savedTargetColor;
	const savedAllowedDifference = readLocalStorage("allowedDifference");
	if (savedAllowedDifference !== null) elems.allowedDifference.value = savedAllowedDifference;
	const savedFilterThreshold = readLocalStorage("filterThreshold");
	if (savedFilterThreshold !== null) elems.filterThreshold.value = savedFilterThreshold;
	if (typeof Notification === "undefined") {
		elems.notifyOnDetection.checked = false;
		elems.notifyOnDetection.disabled = true;
	} else {
		const savedNotifyOnDetection = readLocalStorage("notifyOnDetection");
		const shouldPutCheck = savedNotifyOnDetection !== null && savedNotifyOnDetection !== "0";
		elems.notifyOnDetection.checked = shouldPutCheck && Notification.permission === "granted";
	}

	elems.targetColor.addEventListener("change", () => {
		writeLocalStorage("targetColor", elems.targetColor.value);
	});
	if (typeof EyeDropper === "undefined") {
		elems.useEyeDropper.disabled = true;
	} else {
		elems.useEyeDropper.disabled = false;
		elems.useEyeDropper.addEventListener("click", async () => {
			const eyeDropper = new EyeDropper();
			try {
				const result = await eyeDropper.open();
				elems.targetColor.value = result.sRGBHex;
				writeLocalStorage("targetColor", elems.targetColor.value);
			} catch (e) {
				console.warn(e);
			}
		});
	}
	elems.allowedDifference.addEventListener("change", () => {
		writeLocalStorage("allowedDifference", elems.allowedDifference.value);
	});
	elems.filterThreshold.addEventListener("change", () => {
		writeLocalStorage("filterThreshold", elems.filterThreshold.value);
	});
	let notifyOnDetectionRequestingPermission = false;
	elems.notifyOnDetection.addEventListener("change", async () => {
		if (elems.notifyOnDetection.checked) {
			if (typeof Notification === "undefined") {
				alert("この環境では通知を用いることができません。");
				elems.notifyOnDetection.checked = false;
				return;
			}
			if (Notification.permission === "denied") {
				alert("通知が拒否されています。");
				elems.notifyOnDetection.checked = false;
				return;
			}
			if (Notification.permission !== "granted") {
				if (notifyOnDetectionRequestingPermission) return;
				notifyOnDetectionRequestingPermission = true;
				const result = await Notification.requestPermission();
				notifyOnDetectionRequestingPermission = false;
				if (result !== "granted") {
					elems.notifyOnDetection.checked = false;
					return;
				}
			}
		}
		writeLocalStorage("notifyOnDetection", elems.notifyOnDetection.checked ? "1" : "0");
	});

	const defaultTitle = document.title;
	let notification = null;
	let previousAlerm = null;

	const setAlerm = (isActive) => {
		document.title = (isActive ? "！検知！" : "") + defaultTitle;
		if (elems.notifyOnDetection && isActive !== previousAlerm) {
			if (isActive) {
				notification = new Notification("画面から色を検知しました！");
			} else {
				if (notification !== null) notification.close();
				notification = null;
			}
		}
		previousAlerm = isActive;
	};

	const imageBuffer = new OffscreenCanvas(1280, 720);
	const imageBufferContext = imageBuffer.getContext("2d", {alpha: false, willReadFrequently: true});

	let stream = null;
	let checkerTimerId = null;

	let prevDetection = null;
	let consecutiveDetection = 0;

	const checkColor = () => {
		const targetRGB = elems.targetColor.value;
		const allowedDifference = parseInt(elems.allowedDifference.value, 10);
		const filterThreshold = parseInt(elems.filterThreshold.value, 10);
		if (
			!stream ||
			!/^#[0-9a-f]{6}$/i.test(targetRGB) ||
			isNaN(allowedDifference) || allowedDifference < 0 ||
			isNaN(filterThreshold) || filterThreshold < 1 ||
			elems.capturedVideo.videoWidth === 0 || elems.capturedVideo.videoHeight === 0
		) {
			prevDetection = null;
			consecutiveDetection = 0;
			elems.detectionStatus.textContent = "エラー";
			setAlerm(false);
			return;
		}
		const targetR = parseInt(targetRGB.substring(1, 3), 16);
		const targetG = parseInt(targetRGB.substring(3, 5), 16);
		const targetB = parseInt(targetRGB.substring(5, 7), 16);
		imageBuffer.width = elems.capturedVideo.videoWidth;
		imageBuffer.height = elems.capturedVideo.videoHeight;
		imageBufferContext.drawImage(elems.capturedVideo, 0, 0);
		const imageData = imageBufferContext.getImageData(0, 0, imageBuffer.width, imageBuffer.height);
		let found = false;
		for (let i = 0; i < imageData.data.length; i += 4) {
			if (
				targetR - allowedDifference <= imageData.data[i] &&
				imageData.data[i] <= targetR + allowedDifference &&
				targetG - allowedDifference <= imageData.data[i + 1] &&
				imageData.data[i + 1] <= targetG + allowedDifference &&
				targetB - allowedDifference <= imageData.data[i + 2] &&
				imageData.data[i + 2] <= targetB + allowedDifference
			) {
				found = true;
				break;
			}
		}
		if (found === prevDetection) {
			consecutiveDetection++;
		} else {
			prevDetection = found;
			consecutiveDetection = 1;
		}
		elems.detectionStatus.textContent = (found ? "あり" : "なし") + " (" + consecutiveDetection + "回連続)";
		if (consecutiveDetection === filterThreshold) setAlerm(found);
	};

	elems.startCapture.addEventListener("click", async () => {
		if (stream !== null) return;
		stream = false;
		try {
			const newStream = await navigator.mediaDevices.getDisplayMedia({
				video: true,
				audio: false,
				frameRate: 1,
				preferCurrentTab: false,
				selfBrowserSurface: "exclude",
			});
			elems.capturedVideo.srcObject = newStream;
			elems.capturedVideo.play();
			stream = newStream;
			elems.startCapture.disabled = true;
			elems.stopCapture.disabled = false;
			newStream.getTracks().forEach((track) => {
				track.addEventListener("ended", () => {
					newStream.getTracks().forEach((track) => track.stop());
					stream = null;
					elems.startCapture.disabled = false;
					elems.stopCapture.disabled = true;
					clearInterval(checkerTimerId);
					checkerTimerId = null;
					elems.detectionStatus.textContent = "オフ";
					setAlerm(false);
				});
			});
			checkerTimerId = setInterval(checkColor, 1000);
		} catch (e) {
			stream = null;
			console.error(e);
			alert("キャプチャ開始に失敗しました。");
		}
	});

	elems.stopCapture.addEventListener("click", async () => {
		if (stream === null) return;
		stream.getTracks().forEach((track) => track.stop());
		stream = null;
		elems.startCapture.disabled = false;
		elems.stopCapture.disabled = true;
		clearInterval(checkerTimerId);
		checkerTimerId = null;
		elems.detectionStatus.textContent = "オフ";
		setAlerm(false);
	});
});
