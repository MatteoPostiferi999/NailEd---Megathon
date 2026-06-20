import React, { useEffect, useMemo, useRef, useState } from 'react';
import { base44, clearBase44Session, loginWithEmailPassword } from './api/base44Client';
import { importPinterestImage, searchPinterest } from './api/pinterest';
import landingManicure from './assets/landing-manicure.jpg';
import { defaultStripeCreditPackageId, stripeCreditPackages as packageDefs } from './data/stripeCreditPackages';

const PINK = '#C75C80';
const MUTED = '#B79CA8';

const greetings = [
  ['hey bestie 💅', "let's get you nailed"],
  ['yasss gorgeous ✨', 'time to serve looks'],
  ['hi cutie 👋', 'your next mani awaits'],
  ['well hello 💕', 'ready to slay those tips?'],
  ['it girl alert 🚨', 'manifest the mani ✨'],
];

const recent = [
  { t: 'Coral chrome', d: '6 angles', tag: 'Replica', c1: '#FCE9EF', c2: '#F3C9DA' },
  { t: 'Lilac french', d: '6 angles', tag: 'Concept', c1: '#F3E8F7', c2: '#DFC6EE' },
  { t: 'Peach glaze', d: '6 angles', tag: 'Replica', c1: '#FDEFE6', c2: '#F6D2B8' },
];

const galleryItems = [
  { t: 'Coral chrome', tag: 'Replica', c1: '#FCE9EF', c2: '#F3C9DA' },
  { t: 'Lilac french', tag: 'Concept', c1: '#F3E8F7', c2: '#DFC6EE' },
  { t: 'Peach glaze', tag: 'Replica', c1: '#FDEFE6', c2: '#F6D2B8' },
  { t: 'Cool milk', tag: 'Concept', c1: '#EFEFF8', c2: '#CFD0EC' },
];

const shotDefs = [
  { light: 'Natural light', angle: 'Front', ph: 'hand · render', c1: '#FCE9EF', c2: '#F3C9DA' },
  { light: 'Warm light', angle: '3/4 view', ph: 'hand · render', c1: '#FDEFE6', c2: '#F6D2B8' },
  { light: 'Studio light', angle: 'Close-up', ph: 'macro · render', c1: '#F3E8F7', c2: '#DFC6EE' },
  { light: 'Soft window', angle: 'On chest', ph: 'chest combo', c1: '#FCEAE4', c2: '#F4C4C0' },
  { light: 'Golden hour', angle: 'Near face', ph: 'face combo', c1: '#FAF0E2', c2: '#EBD6AE' },
  { light: 'Cool light', angle: 'Top down', ph: 'flat lay', c1: '#EFEFF8', c2: '#CFD0EC' },
];

const menuItems = ['Subscription & billing', 'Payment methods', 'Notifications', 'Help & support'];
const pendingWaitlistOptInKey = 'nailed_pending_waitlist_opt_in';
const pendingPromoCodeKey = 'nailed_pending_promo_code';
const physicalOutreachPromoCode = 'irl';
const maxImageUploadBytes = 50 * 1024 * 1024;
const uploadSlots = ['hand', 'chest', 'face'];
const imageExtensionByMimeType = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

const normalizeEmail = (value = '') => value.trim().toLowerCase();
const waitlistJoinedKey = (email) => `nailed_waitlist_joined:${normalizeEmail(email)}`;
const isTruthyParam = (value) => ['1', 'true', 'yes'].includes((value || '').toLowerCase());
const shouldOpenSignupFromUrl = (url) => {
  const signupValue = url.searchParams.get('signup');
  return isTruthyParam(signupValue) || url.searchParams.get('auth') === 'signup';
};

const shouldGrantPhysicalOutreachCredits = (url) => {
  return (
    isTruthyParam(url.searchParams.get('irl')) ||
    isTruthyParam(url.searchParams.get('physical')) ||
    url.searchParams.get('outreach') === 'physical'
  );
};

const normalizeCredits = (value) => {
  const credits = Number(value);
  return Number.isFinite(credits) && credits > 0 ? Math.floor(credits) : 0;
};

const getPromoCodeFromUrl = (url) => {
  return shouldGrantPhysicalOutreachCredits(url) ? physicalOutreachPromoCode : '';
};

const rememberPromoCode = (promoCode) => {
  if (promoCode) window.localStorage?.setItem(pendingPromoCodeKey, promoCode);
};

const normalizeImageMimeType = (value = '') => {
  const mimeType = value.toLowerCase().split(';')[0].trim();
  if (mimeType === 'image/jpg') return 'image/jpeg';
  return imageExtensionByMimeType[mimeType] ? mimeType : '';
};

const imageExtensionFromUrl = (imageUrl = '') => {
  try {
    const { pathname } = new URL(imageUrl, window.location.href);
    const match = pathname.match(/\.([a-z0-9]+)$/i);
    const extension = match?.[1]?.toLowerCase();
    if (extension === 'jpeg') return 'jpg';
    if (['jpg', 'png', 'webp', 'gif', 'avif'].includes(extension)) return extension;
  } catch {
    return '';
  }

  return '';
};

const getResultImageUrl = (preview = {}) => preview.cloudinarySecureUrl || preview.secureUrl || preview.signedUrl || preview.imageUrl || '';

const buildResultItems = (generatedPreviews) =>
  generatedPreviews.length
    ? generatedPreviews.map((preview, index) => ({
        id: preview.id || `preview-${index}`,
        imageUrl: getResultImageUrl(preview),
        mimeType: preview.mimeType || preview.contentType || '',
        format: preview.cloudinaryFormat || preview.format || '',
        c1: '#FCE9EF',
        c2: '#F3C9DA',
      }))
    : shotDefs.map((shot, index) => ({
        ...shot,
        id: shot.light,
        tag: 'Replica 100%',
        fallbackIndex: index,
      }));

const resultFileExtension = (item) => {
  const mimeType = normalizeImageMimeType(item?.mimeType);
  if (mimeType) return imageExtensionByMimeType[mimeType];

  const format = String(item?.format || '').toLowerCase();
  if (format === 'jpeg') return 'jpg';
  if (['jpg', 'png', 'webp', 'gif', 'avif'].includes(format)) return format;

  return imageExtensionFromUrl(item?.imageUrl) || 'png';
};

const resultFileName = (item, index) => `nailed-preview-${index + 1}.${resultFileExtension(item)}`;

const triggerBrowserDownload = (href, fileName, { openInNewTab = false } = {}) => {
  const link = document.createElement('a');
  link.href = href;
  link.download = fileName;

  if (openInNewTab) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }

  document.body.appendChild(link);
  link.click();
  link.remove();
};

const downloadResultImage = async (item, index) => {
  const fileName = resultFileName(item, index);

  try {
    const response = await fetch(item.imageUrl, { mode: 'cors' });
    if (!response.ok) throw new Error('Image download failed');

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    triggerBrowserDownload(blobUrl, fileName);
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    return 'downloaded';
  } catch (error) {
    console.warn('Falling back to opening image URL', error);
    triggerBrowserDownload(item.imageUrl, fileName, { openInNewTab: true });
    return 'opened';
  }
};

const consumePendingPromoCode = (fallback = '') => {
  const promoCode = fallback || window.localStorage?.getItem(pendingPromoCodeKey) || '';
  window.localStorage?.removeItem(pendingPromoCodeKey);
  return promoCode;
};

const createImageUpload = (file, source, overrides = {}) => ({
  file,
  source,
  name: file.name || (source === 'camera' ? 'Camera photo' : 'Gallery photo'),
  url: URL.createObjectURL(file),
  status: 'saving',
  ...overrides,
});

const revokeImageUpload = (upload) => {
  if (upload?.url?.startsWith('blob:')) URL.revokeObjectURL(upload.url);
};

const normalizeUploadRecord = (record = {}) => ({
  ...record,
  fileUri: record.fileUri || record.file_uri,
  storageProvider: record.storageProvider || record.storage_provider,
  cloudinaryPublicId: record.cloudinaryPublicId || record.cloudinary_public_id,
  cloudinarySecureUrl: record.cloudinarySecureUrl || record.cloudinary_secure_url,
  cloudinaryVersion: record.cloudinaryVersion || record.cloudinary_version,
  cloudinaryResourceType: record.cloudinaryResourceType || record.cloudinary_resource_type,
  cloudinaryFormat: record.cloudinaryFormat || record.cloudinary_format,
  contentType: record.contentType || record.content_type,
});

const createStoredImageUpload = (record, fallbackUrl) => {
  const normalizedRecord = normalizeUploadRecord(record);
  const imageUrl = normalizedRecord.cloudinarySecureUrl || fallbackUrl;
  return {
    id: normalizedRecord.id,
    source: normalizedRecord.source || 'gallery',
    name: normalizedRecord.fileName || normalizedRecord.name || 'Saved photo',
    url: imageUrl,
    fileUri: normalizedRecord.fileUri,
    storageProvider: normalizedRecord.storageProvider,
    cloudinaryPublicId: normalizedRecord.cloudinaryPublicId,
    cloudinarySecureUrl: normalizedRecord.cloudinarySecureUrl,
    cloudinaryVersion: normalizedRecord.cloudinaryVersion,
    cloudinaryResourceType: normalizedRecord.cloudinaryResourceType,
    cloudinaryFormat: normalizedRecord.cloudinaryFormat,
    status: 'saved',
    saved: true,
  };
};

const hasStoredWaitlistJoin = (email) => {
  const normalizedEmail = normalizeEmail(email);
  return Boolean(normalizedEmail && window.localStorage?.getItem(waitlistJoinedKey(normalizedEmail)) === 'true');
};

const storeWaitlistJoin = (email) => {
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail) window.localStorage?.setItem(waitlistJoinedKey(normalizedEmail), 'true');
};

function Pattern({ c1, c2, className = '', children, style }) {
  return (
    <div
      className={`pattern ${className}`}
      style={{
        '--c1': c1,
        '--c2': c2,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function BackButton({ onClick }) {
  return (
    <button className="circle-button" onClick={onClick} aria-label="Back">
      <ChevronLeftIcon />
    </button>
  );
}

function ChevronLeftIcon() {
  return (
    <svg className="chevron-left-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 18 9 12l6-6" />
    </svg>
  );
}

function App() {
  const [screen, setScreen] = useState('landing');
  const [credits, setCredits] = useState(0);
  const [email, setEmail] = useState('');
  const [authMode, setAuthMode] = useState('register');
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authOtp, setAuthOtp] = useState('');
  const [authStep, setAuthStep] = useState('form');
  const [pendingAuthEmail, setPendingAuthEmail] = useState('');
  const [authPending, setAuthPending] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [savedShots, setSavedShots] = useState({});
  const [uploads, setUploads] = useState({ hand: null, chest: null, face: null });
  const [waitlistOptIn, setWaitlistOptIn] = useState(true);
  const [joinedWaitlist, setJoinedWaitlist] = useState(false);
  const [inspLoaded, setInspLoaded] = useState(null);
  const [query, setQuery] = useState('chrome');
  const [resultLabel, setResultLabel] = useState('chrome nails');
  const [saved, setSaved] = useState({});
  const [pinterestResults, setPinterestResults] = useState([]);
  const [pinterestLoading, setPinterestLoading] = useState(false);
  const [pinterestError, setPinterestError] = useState('');
  const [pinterestLastQuery, setPinterestLastQuery] = useState('');
  const [pinterestImportingId, setPinterestImportingId] = useState('');
  const [selectedPkg, setSelectedPkg] = useState(defaultStripeCreditPackageId);
  const [gallery, setGallery] = useState(0);
  const [generatedPreviews, setGeneratedPreviews] = useState([]);
  const [toast, setToast] = useState('');
  const [toastShown, setToastShown] = useState(false);
  const [waitlistPending, setWaitlistPending] = useState(false);
  const [savedUploadsLoading, setSavedUploadsLoading] = useState(false);
  const [generationPending, setGenerationPending] = useState(false);
  const [progress, setProgress] = useState(0);
  const dragStartRef = useRef(null);
  const toastTimerRef = useRef(null);
  const uploadsRef = useRef(uploads);
  const inspLoadedRef = useRef(inspLoaded);
  const greetIdx = useMemo(() => Math.floor(Math.random() * greetings.length), []);
  const resultItems = useMemo(() => buildResultItems(generatedPreviews), [generatedPreviews]);
  const savedCount = Object.keys(saved).length;
  const showTabs = ['home', 'search', 'account'].includes(screen);
  const resultCount = resultItems.length;

  const applyUserCredits = (user) => {
    const nextCredits = normalizeCredits(user?.credits);
    setCredits(nextCredits);
    return nextCredits;
  };

  const syncCredits = async (action = 'initialize', data = {}) => {
    const response = await base44.functions.invoke('credits', { action, ...data });
    const updatedUser = response?.data?.user || response?.user;
    const nextCredits = normalizeCredits(response?.data?.credits ?? response?.credits ?? updatedUser?.credits);

    if (updatedUser) setCurrentUser(updatedUser);
    setCredits(nextCredits);
    return { user: updatedUser, credits: nextCredits, promoApplied: Boolean(response?.data?.promoApplied || response?.promoApplied) };
  };

  useEffect(() => {
    const restoreAuth = async () => {
      try {
        const url = new URL(window.location.href);
        const tokenFromUrl = url.searchParams.get('access_token');
        const isNewUser = url.searchParams.get('is_new_user') === 'true';
        const shouldJoinWaitlist = window.localStorage?.getItem(pendingWaitlistOptInKey) === 'true';
        const shouldOpenSignup = shouldOpenSignupFromUrl(url);
        const promoCodeFromUrl = getPromoCodeFromUrl(url);
        const paymentStatus = url.searchParams.get('payment');

        rememberPromoCode(promoCodeFromUrl);

        if (tokenFromUrl) {
          base44.setToken(tokenFromUrl);
          url.searchParams.delete('access_token');
          url.searchParams.delete('is_new_user');
        }

        const storedToken = window.localStorage?.getItem('base44_access_token') || window.localStorage?.getItem('token');
        if (!tokenFromUrl && !storedToken) {
          if (shouldOpenSignup) {
            setAuthMode('register');
            setScreen('auth');
          }
          return;
        }

        const user = await base44.auth.me();
        setCurrentUser(user);
        setAuthEmail(user.email || '');
        applyUserCredits(user);

        try {
          const promoCode = isNewUser ? consumePendingPromoCode(promoCodeFromUrl) : '';
          await syncCredits('initialize', promoCode ? { promoCode } : {});
        } catch (error) {
          console.warn('Could not sync user credits', error);
          applyUserCredits(user);
        }

        if (paymentStatus === 'success') {
          showToast('Payment received · credits updating');
        } else if (paymentStatus === 'cancel') {
          showToast('Payment cancelled');
        }

        if (tokenFromUrl || paymentStatus) {
          url.searchParams.delete('access_token');
          url.searchParams.delete('is_new_user');
          url.searchParams.delete('payment');
          url.searchParams.delete('session_id');
          window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
        }

        const joinedFromUser = Boolean(user.waitlist_joined || user.waitlistJoined);
        const joinedFromStorage = hasStoredWaitlistJoin(user.email);
        setJoinedWaitlist(joinedFromUser || joinedFromStorage);

        if (isNewUser && shouldJoinWaitlist && user.email) {
          try {
            await reserveWaitlistSpot(user.email, 'auth-social');
          } catch (error) {
            console.warn('Could not save social signup waitlist entry', error);
          } finally {
            window.localStorage?.removeItem(pendingWaitlistOptInKey);
          }
        } else {
          window.localStorage?.removeItem(pendingWaitlistOptInKey);
        }

        if (screen === 'landing' || screen === 'auth') setScreen('home');
      } catch (error) {
        setCurrentUser(null);
      }
    };

    restoreAuth();
    // Auth restoration should run only once on app boot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    uploadsRef.current = uploads;
  }, [uploads]);

  useEffect(() => {
    inspLoadedRef.current = inspLoaded;
  }, [inspLoaded]);

  useEffect(() => {
    return () => {
      Object.values(uploadsRef.current).forEach(revokeImageUpload);
      revokeImageUpload(inspLoadedRef.current);
    };
  }, []);

  useEffect(() => {
    if (!currentUser) return undefined;

    let cancelled = false;
    const loadSavedUploads = async () => {
      setSavedUploadsLoading(true);
      try {
        const records = await base44.entities.UserUpload.filter({}, '-created_date', 60);
        const latestBySlot = {};

        records.forEach((record) => {
          const normalizedRecord = normalizeUploadRecord(record);
          if (!(normalizedRecord.cloudinarySecureUrl || normalizedRecord.fileUri) || latestBySlot[normalizedRecord.slot]) return;
          latestBySlot[normalizedRecord.slot] = normalizedRecord;
        });

        const entries = (await Promise.all(
          Object.entries(latestBySlot).map(async ([slot, record]) => {
            if (record.cloudinarySecureUrl) {
              return [slot, createStoredImageUpload(record)];
            }

            const { signed_url: signedUrl } = await base44.integrations.Core.CreateFileSignedUrl({
              file_uri: record.fileUri,
              expires_in: 3600,
            });
            return [slot, createStoredImageUpload(record, signedUrl)];
          })
        )).filter(Boolean);

        if (cancelled) return;

        setUploads((value) => {
          const next = { ...value };
          entries.forEach(([slot, upload]) => {
            if (!uploadSlots.includes(slot)) return;
            if (next[slot]?.file) return;
            revokeImageUpload(next[slot]);
            next[slot] = upload;
          });
          return next;
        });

        const inspirationUpload = entries.find(([slot]) => slot === 'inspiration')?.[1];
        if (inspirationUpload) {
          setInspLoaded((value) => {
            if (value?.file) return value;
            revokeImageUpload(value);
            return inspirationUpload;
          });
        }
      } catch (error) {
        console.warn('Could not load saved uploads', error);
      } finally {
        if (!cancelled) setSavedUploadsLoading(false);
      }
    };

    loadSavedUploads();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  useEffect(() => {
    if (screen !== 'generating') return undefined;
    let current = 0;
    setProgress(0);
    const interval = window.setInterval(() => {
      current = Math.min(92, current + 2 + Math.random() * 5);
      setProgress(current);
    }, 220);
    return () => window.clearInterval(interval);
  }, [screen]);

  useEffect(() => {
    setAuthStep('form');
    setAuthOtp('');
    setPendingAuthEmail('');
  }, [authMode]);

  useEffect(() => {
    if (screen !== 'search' || pinterestLoading) return;

    const initialQuery = String(resultLabel || query || '').trim();
    if (!initialQuery) return;

    if (pinterestLastQuery.toLowerCase() === initialQuery.toLowerCase() && (pinterestResults.length || pinterestError)) {
      return;
    }

    void runPinterestSearch(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  const showToast = (message) => {
    setToast(message);
    setToastShown(true);
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastShown(false), 2200);
  };

  const completeAuth = async (user, { promoCode = '' } = {}) => {
    let nextUser = user;
    setCurrentUser(nextUser);
    setAuthEmail(nextUser?.email || '');
    applyUserCredits(nextUser);

    try {
      const synced = await syncCredits('initialize', promoCode ? { promoCode } : {});
      if (synced.user) nextUser = synced.user;
    } catch (error) {
      console.warn('Could not initialize user credits', error);
    }

    setJoinedWaitlist(Boolean(nextUser?.waitlist_joined || nextUser?.waitlistJoined || hasStoredWaitlistJoin(nextUser?.email)));
    setScreen('home');
  };

  const extractErrorMessage = (error, fallback) => {
    const data = error?.response?.data || error?.data;
    return data?.message || data?.detail || data?.error || error?.message || fallback;
  };

  const handleEmailAuth = async () => {
    const normalizedEmail = authEmail.trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      showToast('Enter a valid email');
      return;
    }

    if (authPassword.length < 8) {
      showToast('Password needs 8+ characters');
      return;
    }

    setAuthPending(true);
    try {
      let loginResponse;

      if (authMode === 'register') {
        await base44.auth.register({
          email: normalizedEmail,
          password: authPassword,
        });

        setPendingAuthEmail(normalizedEmail);
        setAuthStep('otp');
        setAuthOtp('');
        showToast('Check your email for the code');
        return;
      } else {
        loginResponse = await loginWithEmailPassword(normalizedEmail, authPassword);
      }

      await completeAuth(loginResponse.user || (await base44.auth.me()));
      showToast(authMode === 'register' ? 'Account created 💅' : 'Welcome back 💕');
    } catch (error) {
      console.error('Base44 auth failed', error);
      showToast(extractErrorMessage(error, authMode === 'register' ? 'Could not create account' : 'Could not log in'));
    } finally {
      setAuthPending(false);
    }
  };

  const handleVerifyOtp = async () => {
    const normalizedEmail = (pendingAuthEmail || authEmail).trim().toLowerCase();
    const otpCode = authOtp.trim();

    if (otpCode.length < 4) {
      showToast('Enter the email code');
      return;
    }

    setAuthPending(true);
    try {
      const verifyResponse = await base44.auth.verifyOtp({ email: normalizedEmail, otpCode });
      let user = verifyResponse?.user;

      if (verifyResponse?.access_token) {
        base44.setToken(verifyResponse.access_token);
        user = user || (await base44.auth.me());
      } else {
        const loginResponse = await loginWithEmailPassword(normalizedEmail, authPassword);
        user = loginResponse.user || (await base44.auth.me());
      }

      if (authName.trim()) {
        try {
          await base44.auth.updateMe({ display_name: authName.trim() });
          user = { ...user, display_name: authName.trim() };
        } catch (error) {
          console.warn('Could not save optional display name', error);
        }
      }

      if (waitlistOptIn) {
        try {
          await reserveWaitlistSpot(normalizedEmail, 'auth-register');
          user = { ...user, waitlist_joined: true };
        } catch (error) {
          console.warn('Could not save optional waitlist entry', error);
          showToast('Account created · waitlist save failed');
        }
      }

      await completeAuth(user, { promoCode: consumePendingPromoCode() });
      showToast('Account verified 💅');
    } catch (error) {
      console.error('Base44 OTP verification failed', error);
      showToast(extractErrorMessage(error, 'Invalid or expired code'));
    } finally {
      setAuthPending(false);
    }
  };

  const handleResendOtp = async () => {
    const normalizedEmail = (pendingAuthEmail || authEmail).trim().toLowerCase();

    setAuthPending(true);
    try {
      await base44.auth.resendOtp(normalizedEmail);
      showToast('New code sent');
    } catch (error) {
      console.error('Base44 OTP resend failed', error);
      showToast(extractErrorMessage(error, 'Could not resend code'));
    } finally {
      setAuthPending(false);
    }
  };

  const handleCancelOtp = () => {
    setAuthStep('form');
    setAuthOtp('');
  };

  const rememberSocialWaitlistIntent = () => {
    if (authMode === 'register' && waitlistOptIn) {
      window.localStorage?.setItem(pendingWaitlistOptInKey, 'true');
    } else {
      window.localStorage?.removeItem(pendingWaitlistOptInKey);
    }
  };

  const rememberCurrentPromoIntent = () => {
    rememberPromoCode(getPromoCodeFromUrl(new URL(window.location.href)));
  };

  const handleGoogleAuth = () => {
    rememberSocialWaitlistIntent();
    rememberCurrentPromoIntent();
    base44.auth.loginWithProvider('google', window.location.href);
  };

  const handleAppleAuth = () => {
    rememberSocialWaitlistIntent();
    rememberCurrentPromoIntent();
    base44.auth.loginWithProvider('apple', window.location.href);
  };

  const handleLogout = () => {
    setCurrentUser(null);
    clearBase44Session();
    window.location.replace(window.location.origin);
  };

  const startGeneration = async () => {
    if (!currentUser) {
      setScreen('auth');
      showToast('Log in to generate');
      return;
    }

    if (!uploads.hand?.id || uploads.hand.status === 'saving') {
      showToast('Save a hand photo first');
      setScreen('upload');
      return;
    }

    if (!inspLoaded?.id || inspLoaded.status === 'saving') {
      showToast('Add an inspo photo first');
      setScreen('inspiration');
      return;
    }

    if (credits <= 0) {
      setScreen('paywall');
      return;
    }

    const targetUploadIds = uploadSlots
      .map((slot) => uploads[slot])
      .filter((upload) => upload?.id && upload.status !== 'saving')
      .map((upload) => upload.id);

    try {
      setGenerationPending(true);
      setGeneratedPreviews([]);
      setProgress(4);
      setScreen('generating');

      const response = await base44.functions.invoke('generateNailPreview', {
        targetUploadIds,
        inspoUploadId: inspLoaded.id,
      });
      const data = response?.data || response;
      const previews = Array.isArray(data?.previews) ? data.previews : [];

      if (!previews.length) {
        throw new Error(data?.error || 'No previews returned');
      }

      setGeneratedPreviews(previews);
      setGallery(0);
      setProgress(100);
      if (data?.user) setCurrentUser(data.user);
      if (Number.isFinite(Number(data?.credits))) setCredits(Math.max(0, Math.floor(Number(data.credits))));
      setScreen('results');
    } catch (error) {
      console.error('Could not generate preview', error);
      const status = error?.response?.status;
      if (status === 402) {
        setCredits(0);
        setScreen('paywall');
        return;
      }
      if (status === 501) {
        showToast('Gemini key missing');
      } else {
        showToast(extractErrorMessage(error, 'Could not generate preview'));
      }
      setScreen('inspiration');
    } finally {
      setGenerationPending(false);
    }
  };

  const toggleSave = (id) => {
    const key = typeof id === 'object' && id?.id ? id.id : id;
    setSaved((value) => {
      const next = { ...value };
      if (next[key]) delete next[key];
      else next[key] = typeof id === 'object' ? id : true;
      return next;
    });
  };

  const runPinterestSearch = async (nextQuery = query) => {
    const trimmedQuery = String(nextQuery || '').trim();

    if (!trimmedQuery) {
      showToast('Type a Pinterest search first');
      return;
    }

    setQuery(trimmedQuery);
    setResultLabel(trimmedQuery);
    setPinterestLoading(true);
    setPinterestError('');

    try {
      const data = await searchPinterest(trimmedQuery, { limit: 18 });
      const results = Array.isArray(data.results) ? data.results : [];
      setPinterestResults(results);
      setPinterestLastQuery(trimmedQuery);
      setPinterestError(results.length ? '' : 'No Pinterest pins came back for that search.');
    } catch (error) {
      console.error('Pinterest search failed', error);
      setPinterestResults([]);
      setPinterestError(extractErrorMessage(error, 'Could not load Pinterest right now'));
    } finally {
      setPinterestLoading(false);
    }
  };

  const usePinterestPin = async (pin) => {
    if (!currentUser) {
      setScreen('auth');
      showToast('Log in to use Pinterest inspo');
      return;
    }

    if (!pin?.imageUrl) {
      showToast('This Pinterest image is missing');
      return;
    }

    setPinterestImportingId(pin.id);

    try {
      const imported = await importPinterestImage(pin);
      if (!imported?.upload || !imported?.signedUrl) {
        throw new Error('Pinterest import did not return an image');
      }

      setInspLoaded((value) => {
        revokeImageUpload(value);
        return createStoredImageUpload(
          {
            ...imported.upload,
            source: 'pinterest',
            fileName: imported.upload.fileName || pin.title,
          },
          imported.signedUrl
        );
      });

      showToast('Pinterest inspo added');
      setScreen('inspiration');
    } catch (error) {
      console.error('Could not import Pinterest image', error);
      showToast(extractErrorMessage(error, 'Could not use this Pinterest image'));
    } finally {
      setPinterestImportingId('');
    }
  };

  const createWaitlistEntry = async (entryEmail, source = 'landing') => {
    return base44.entities.WaitlistEntry.create({
      email: normalizeEmail(entryEmail),
      source,
      status: 'joined',
      freeTryOnsReserved: 10,
    });
  };

  const reserveWaitlistSpot = async (entryEmail, source = 'landing') => {
    const normalizedEmail = normalizeEmail(entryEmail);
    await createWaitlistEntry(normalizedEmail, source);
    storeWaitlistJoin(normalizedEmail);
    setJoinedWaitlist(true);

    if (source !== 'landing') {
      try {
        await base44.auth.updateMe({ waitlist_joined: true });
      } catch (error) {
        console.warn('Could not save waitlist marker on user profile', error);
      }
    }
  };

  const joinWaitlist = async (source = 'landing', explicitEmail) => {
    const normalizedEmail = normalizeEmail(explicitEmail || currentUser?.email || authEmail || email);
    const looksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);

    if (!looksValid) {
      showToast('Enter a valid email first');
      return false;
    }

    setWaitlistPending(true);
    try {
      await reserveWaitlistSpot(normalizedEmail, source);
      setEmail(normalizedEmail);
      showToast("You're on the list! 💌");
      return true;
    } catch (error) {
      console.error('Base44 waitlist save failed', error);
      showToast('Could not save yet · try again');
      return false;
    } finally {
      setWaitlistPending(false);
    }
  };

  const saveShot = (index) => {
    const wasSaved = Boolean(savedShots[index]);
    setSavedShots((value) => {
      const next = { ...value };
      if (next[index]) delete next[index];
      else next[index] = true;
      return next;
    });
    showToast(wasSaved ? 'Removed from gallery' : 'Image saved to gallery ♥');
  };

  const saveAllShots = () => {
    if (!resultItems.length) {
      showToast('No previews to save yet');
      return;
    }

    setSavedShots(Object.fromEntries(resultItems.map((_, index) => [index, true])));
    showToast('All previews saved to gallery ♥');
  };

  const downloadShot = async (index = gallery) => {
    const item = resultItems[index] || resultItems[gallery] || resultItems[0];

    if (!item?.imageUrl) {
      showToast('Generate a preview first');
      return;
    }

    const result = await downloadResultImage(item, index);
    showToast(result === 'opened' ? 'Opened image to save' : 'Preview downloaded');
  };

  const shareLook = async () => {
    const item = resultItems[gallery] || resultItems[0];
    const shareUrl = item?.imageUrl || window.location.href;
    const shareData = {
      title: 'My Nailed preview',
      text: 'Check out this nail preview from Nailed.',
      url: shareUrl,
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
        showToast('Shared your look');
        return;
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        showToast('Share link copied');
        return;
      }

      throw new Error('Share is not supported');
    } catch (error) {
      if (error?.name === 'AbortError') return;

      console.error('Could not share look', error);
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard is not supported');
        await navigator.clipboard.writeText(shareUrl);
        showToast('Share link copied');
      } catch {
        showToast('Could not share yet');
      }
    }
  };

  const startCreditCheckout = async () => {
    if (!currentUser) {
      setScreen('auth');
      showToast('Log in to buy credits');
      return;
    }

    try {
      const response = await base44.functions.invoke('createStripeCheckout', { packageId: selectedPkg });
      const checkoutUrl = response?.data?.checkoutUrl || response?.checkoutUrl;

      if (!checkoutUrl) throw new Error('Checkout URL missing');
      window.location.href = checkoutUrl;
    } catch (error) {
      console.error('Could not start checkout', error);
      const status = error?.status || error?.response?.status;
      showToast(status === 501 ? 'Stripe setup needed first' : 'Could not start payment');
    }
  };

  const galleryPrev = () => setGallery((value) => (value + resultCount - 1) % resultCount);
  const galleryNext = () => setGallery((value) => (value + 1) % resultCount);

  const startDrag = (event) => {
    dragStartRef.current = 'touches' in event ? event.touches[0].clientY : event.clientY;
  };

  const endDrag = (event) => {
    const start = dragStartRef.current;
    if (start == null) return;
    const y = 'changedTouches' in event ? event.changedTouches[0].clientY : event.clientY;
    const distance = y - start;
    if (distance < -38) galleryNext();
    else if (distance > 38) galleryPrev();
    dragStartRef.current = null;
  };

  const cancelDrag = () => {
    dragStartRef.current = null;
  };

  const validateImageFile = (file) => {
    if (!file) return false;
    if (!file.type?.startsWith('image/')) {
      showToast('Choose an image file');
      return false;
    }
    if (file.size > maxImageUploadBytes) {
      showToast('Image must be under 50MB');
      return false;
    }
    return true;
  };

  const uploadFileToCloudinary = async ({ slot, file }) => {
    const signatureResponse = await base44.functions.invoke('createCloudinaryUploadSignature', {
      slot,
      fileName: file.name || slot,
      contentType: file.type || 'image/jpeg',
    });
    const signatureData = signatureResponse?.data || signatureResponse;

    if (!signatureData?.signature || !signatureData?.cloudName || !signatureData?.apiKey) {
      throw new Error(signatureData?.error || 'Could not prepare Cloudinary upload');
    }

    const form = new FormData();
    form.append('file', file);
    form.append('api_key', signatureData.apiKey);
    form.append('timestamp', String(signatureData.timestamp));
    form.append('signature', signatureData.signature);
    form.append('folder', signatureData.folder);
    form.append('public_id', signatureData.publicId);

    const uploadResponse = await fetch(`https://api.cloudinary.com/v1_1/${signatureData.cloudName}/image/upload`, {
      method: 'POST',
      body: form,
    });
    const uploaded = await uploadResponse.json().catch(() => ({}));

    if (!uploadResponse.ok) {
      throw new Error(uploaded?.error?.message || 'Cloudinary upload failed');
    }

    return uploaded;
  };

  const persistUserUpload = async ({ slot, file, source, existingId }) => {
    const uploaded = await uploadFileToCloudinary({ slot, file });
    const data = {
      slot,
      source,
      fileUri: '',
      storageProvider: 'cloudinary',
      cloudinaryPublicId: uploaded.public_id,
      cloudinarySecureUrl: uploaded.secure_url,
      cloudinaryVersion: uploaded.version,
      cloudinaryResourceType: uploaded.resource_type || 'image',
      cloudinaryFormat: uploaded.format || '',
      fileName: file.name || (source === 'camera' ? 'Camera photo' : 'Gallery photo'),
      contentType: file.type || 'image/jpeg',
      sizeBytes: file.size || 0,
    };

    return existingId
      ? base44.entities.UserUpload.update(existingId, data)
      : base44.entities.UserUpload.create(data);
  };

  const saveUploadFile = async (slot, file, source) => {
    if (!validateImageFile(file)) return;
    if (!currentUser) {
      showToast('Log in to save uploads');
      setScreen('auth');
      return;
    }

    const previousUpload = uploadsRef.current[slot];
    const pendingUpload = createImageUpload(file, source);
    setUploads((value) => {
      revokeImageUpload(value[slot]);
      return { ...value, [slot]: pendingUpload };
    });

    try {
      const record = await persistUserUpload({
        slot,
        file,
        source,
        existingId: previousUpload?.id,
      });
      const savedRecord = normalizeUploadRecord(record);

      setUploads((value) => {
        if (value[slot] !== pendingUpload) return value;
        return {
          ...value,
          [slot]: {
            ...value[slot],
            id: savedRecord.id,
            fileUri: savedRecord.fileUri,
            storageProvider: savedRecord.storageProvider,
            cloudinaryPublicId: savedRecord.cloudinaryPublicId,
            cloudinarySecureUrl: savedRecord.cloudinarySecureUrl,
            cloudinaryVersion: savedRecord.cloudinaryVersion,
            cloudinaryResourceType: savedRecord.cloudinaryResourceType,
            cloudinaryFormat: savedRecord.cloudinaryFormat,
            status: 'saved',
            saved: true,
          },
        };
      });
      showToast('Upload saved');
    } catch (error) {
      console.error('Could not save upload', error);
      setUploads((value) => {
        if (value[slot] !== pendingUpload) return value;
        return {
          ...value,
          [slot]: {
            ...value[slot],
            status: 'error',
            saved: false,
          },
        };
      });
      showToast('Could not save upload');
    }
  };

  const saveInspoFile = async (file, source) => {
    if (!validateImageFile(file)) return;
    if (!currentUser) {
      showToast('Log in to save uploads');
      setScreen('auth');
      return;
    }

    const previousUpload = inspLoadedRef.current;
    const pendingUpload = createImageUpload(file, source);
    setInspLoaded((value) => {
      revokeImageUpload(value);
      return pendingUpload;
    });

    try {
      const record = await persistUserUpload({
        slot: 'inspiration',
        file,
        source,
        existingId: previousUpload?.id,
      });
      const savedRecord = normalizeUploadRecord(record);

      setInspLoaded((value) => {
        if (value !== pendingUpload) return value;
        return {
          ...value,
          id: savedRecord.id,
          fileUri: savedRecord.fileUri,
          storageProvider: savedRecord.storageProvider,
          cloudinaryPublicId: savedRecord.cloudinaryPublicId,
          cloudinarySecureUrl: savedRecord.cloudinarySecureUrl,
          cloudinaryVersion: savedRecord.cloudinaryVersion,
          cloudinaryResourceType: savedRecord.cloudinaryResourceType,
          cloudinaryFormat: savedRecord.cloudinaryFormat,
          status: 'saved',
          saved: true,
        };
      });
      showToast('Inspo saved');
    } catch (error) {
      console.error('Could not save inspiration upload', error);
      setInspLoaded((value) => {
        if (value !== pendingUpload) return value;
        return {
          ...value,
          status: 'error',
          saved: false,
        };
      });
      showToast('Could not save inspo');
    }
  };

  const context = {
    screen,
    setScreen,
    credits,
    setCredits,
    email,
    setEmail,
    authMode,
    setAuthMode,
    authName,
    setAuthName,
    authEmail,
    setAuthEmail,
    authPassword,
    setAuthPassword,
    authOtp,
    setAuthOtp,
    authStep,
    pendingAuthEmail,
    authPending,
    currentUser,
    savedShots,
    uploads,
    setUploads,
    saveUploadFile,
    waitlistOptIn,
    setWaitlistOptIn,
    joinedWaitlist,
    setJoinedWaitlist,
    inspLoaded,
    setInspLoaded,
    saveInspoFile,
    query,
    setQuery,
    resultLabel,
    setResultLabel,
    saved,
    savedCount,
    pinterestResults,
    pinterestLoading,
    pinterestError,
    pinterestImportingId,
    selectedPkg,
    setSelectedPkg,
    gallery,
    setGallery,
    generatedPreviews,
    resultItems,
    generationPending,
    waitlistPending,
    savedUploadsLoading,
    progress,
    greet: greetings[greetIdx],
    handleEmailAuth,
    handleVerifyOtp,
    handleResendOtp,
    handleCancelOtp,
    handleGoogleAuth,
    handleAppleAuth,
    handleLogout,
    showToast,
    joinWaitlist,
    startGeneration,
    toggleSave,
    runPinterestSearch,
    usePinterestPin,
    saveShot,
    saveAllShots,
    downloadShot,
    shareLook,
    startCreditCheckout,
    galleryPrev,
    galleryNext,
    startDrag,
    endDrag,
    cancelDrag,
  };

  return (
    <div className="app-stage">
      <div className="app-shell">
        <div className="app-content">
          {screen === 'landing' && <LandingScreen {...context} />}
          {screen === 'auth' && <AuthScreen {...context} />}
          {screen === 'home' && <HomeScreen {...context} />}
          {screen === 'upload' && <UploadScreen {...context} />}
          {screen === 'inspiration' && <InspirationScreen {...context} />}
          {screen === 'search' && <SearchScreen {...context} />}
          {screen === 'generating' && <GeneratingScreen {...context} />}
          {screen === 'results' && <ResultsScreen {...context} />}
          {screen === 'paywall' && <PaywallScreen {...context} />}
          {screen === 'account' && <AccountScreen {...context} />}
        </div>
        {showTabs && <TabBar screen={screen} setScreen={setScreen} />}
        <div className={`toast ${toastShown ? 'toast-visible' : ''}`}>{toast}</div>
      </div>
    </div>
  );
}

function LandingScreen({ setScreen }) {
  return (
    <section className="screen scroll landing-screen">
      <div className="landing-pad rise">
        <div className="landing-brand-lockup">
          <div className="brand landing-logo">
            nailed<span>.</span>
          </div>
          <div className="landing-kicker">AI nail previews</div>
        </div>

        <div className="landing-hero">
          <h1>Try any nail set on your hand.</h1>
          <p>Upload your hand. Add the nail idea. See it before you book.</p>
        </div>

        <div className="landing-photo-frame">
          <img src={landingManicure} alt="Manicured hands with rings" />
          <div className="landing-photo-caption">
            <span>Preview any set on your hand</span>
            <b>before the appointment</b>
          </div>
        </div>

        <div className="landing-actions">
          <button className="dark-wide-button" onClick={() => setScreen('auth')}>
            Create account
          </button>
          <button className="outline-pink-button" onClick={() => setScreen('auth')}>
            Log in
          </button>
        </div>
      </div>
    </section>
  );
}

function AuthScreen({
  authMode,
  setAuthMode,
  authName,
  setAuthName,
  authEmail,
  setAuthEmail,
  authPassword,
  setAuthPassword,
  authOtp,
  setAuthOtp,
  authStep,
  pendingAuthEmail,
  authPending,
  waitlistOptIn,
  setWaitlistOptIn,
  handleEmailAuth,
  handleVerifyOtp,
  handleResendOtp,
  handleCancelOtp,
  handleGoogleAuth,
  handleAppleAuth,
  setScreen,
}) {
  const isRegister = authMode === 'register';
  const isOtp = authStep === 'otp';
  const otpEmail = pendingAuthEmail || authEmail;

  return (
    <section className="screen scroll">
      <div className="content-pad rise">
        <BackButton onClick={() => setScreen('landing')} />
        <div className="auth-head">
          <div className="brand large">
            nailed<span>.</span>
          </div>
          <h2>{isOtp ? 'Check your email' : authMode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
          <p>
            {isOtp
              ? `Enter the code sent to ${otpEmail}`
              : authMode === 'login'
                ? 'Log in to keep trying looks'
                : 'Create your account to start trying looks'}
          </p>
        </div>

        {isOtp ? (
          <>
            <div className="form-stack otp-stack">
              <InputBlock
                label="Verification code"
                placeholder="123456"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={authOtp}
                onChange={(event) => setAuthOtp(event.target.value)}
              />
            </div>
            <button className="outline-pink-button" disabled={authPending} onClick={handleVerifyOtp}>
              {authPending ? 'Please wait...' : 'Verify & continue'}
            </button>
            <div className="auth-actions-row">
              <button disabled={authPending} onClick={handleResendOtp}>
                Resend code
              </button>
              <button disabled={authPending} onClick={handleCancelOtp}>
                Change email
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="segmented">
              <button className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')}>
                Log in
              </button>
              <button className={isRegister ? 'active' : ''} onClick={() => setAuthMode('register')}>
                Sign up
              </button>
            </div>

            <div className="social-auth-stack">
              <button className="google-button" onClick={handleGoogleAuth}>
                <GoogleLogo />
                {authMode === 'login' ? 'Continue with Google' : 'Sign up with Google'}
              </button>
              <button className="apple-button" onClick={handleAppleAuth}>
                <AppleLogo />
                {authMode === 'login' ? 'Continue with Apple' : 'Sign up with Apple'}
              </button>
            </div>

            {isRegister && (
              <button
                className={`waitlist-option ${waitlistOptIn ? 'selected' : ''}`}
                onClick={() => setWaitlistOptIn((value) => !value)}
              >
                <span>{waitlistOptIn ? '✓' : ''}</span>
                <div>
                  <b>Join the waitlist 💌</b>
                  <small>Get early access updates when we launch</small>
                </div>
              </button>
            )}

            <Divider>or with email</Divider>
            <div className="form-stack">
              {isRegister && (
                <InputBlock label="Name" placeholder="Julia" value={authName} onChange={(event) => setAuthName(event.target.value)} />
              )}
              <InputBlock
                label="Email"
                placeholder="julia@email.com"
                type="email"
                autoComplete="email"
                value={authEmail}
                onChange={(event) => setAuthEmail(event.target.value)}
              />
              <InputBlock
                label="Password"
                placeholder="••••••••"
                type="password"
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
              />
            </div>

            <button className="outline-pink-button" disabled={authPending} onClick={handleEmailAuth}>
              {authPending ? 'Please wait...' : authMode === 'login' ? 'Log in' : 'Create account'}
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function InputBlock({ label, ...props }) {
  return (
    <label className="input-block">
      <span>{label}</span>
      <input {...props} />
    </label>
  );
}

function Divider({ children }) {
  return (
    <div className="divider">
      <span />
      {children}
      <span />
    </div>
  );
}

function HomeScreen({ credits, greet, joinedWaitlist, joinWaitlist, waitlistPending, setScreen }) {
  return (
    <section className="screen scroll tabs-space">
      <div className="home-pad rise">
        <div className="top-row">
          <div>
            <div className="greet-top">{greet[0]}</div>
            <div className="greet-main">{greet[1]}</div>
          </div>
          <button className="credit-chip" onClick={() => setScreen('paywall')}>
            <span>💎</span>
            <b>{credits}</b>
          </button>
        </div>

        {!joinedWaitlist && (
          <div className="gradient-border-card">
            <div className="waitlist-dark">
              <div className="dark-glow top" />
              <div className="dark-glow bottom" />
              <div className="limited-pill">✦ Limited · 500 spots</div>
              <h2>
                You're not on the
                <br />
                waitlist <em>yet</em>.
              </h2>
              <p>
                Join now and unlock <b>10 free try-ons</b> the day we launch ✨
              </p>
              <button disabled={waitlistPending} onClick={() => joinWaitlist('home')}>
                {waitlistPending ? 'Saving your spot...' : 'Join the waitlist — free 💌'}
              </button>
            </div>
          </div>
        )}

        <button className="hero-cta" onClick={() => setScreen('upload')}>
          <div className="hero-cta-glow top" />
          <div className="hero-cta-glow bottom" />
          <span className="mini-pill">✦ AI try-on</span>
          <h2>
            Try it
            <br />
            <em>on you</em> 💅
          </h2>
          <p>See any nails on your hand in seconds ✨</p>
          <span className="hero-inner-button">Let's go →</span>
        </button>

        <div className="quick-actions">
          <button className="quick-card" onClick={() => setScreen('search')}>
            <span className="icon-box purple">
              <SearchIcon />
            </span>
            <b>Explore ideas</b>
            <small>Search Pinterest</small>
          </button>
          <button className="quick-card" onClick={() => setScreen('account')}>
            <span className="icon-box peach">
              <GridIcon />
            </span>
            <b>My try-ons</b>
            <small>Saved gallery</small>
          </button>
        </div>

        <div className="section-title-row">
          <h2>Your recent try-ons</h2>
        </div>
        <div className="recent-row">
          {recent.map((item) => (
            <button key={item.t} className="recent-card" onClick={() => setScreen('results')}>
              <Pattern c1={item.c1} c2={item.c2}>
                <span>{item.tag}</span>
              </Pattern>
              <b>{item.t}</b>
              <small>{item.d}</small>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function UploadScreen({ uploads, saveUploadFile, savedUploadsLoading, setScreen }) {
  const galleryInputRefs = useRef({});
  const slots = [
    { k: 'hand', t: 'Open hand', d: 'Flat, well-lit shot of your hand', required: true },
    { k: 'chest', t: 'Hand on chest', d: 'Shows the look with your skin & outfit', required: false },
    { k: 'face', t: 'Near the face', d: 'For a full styling preview', required: false },
  ];
  const handleFile = (event, slot, source) => {
    const file = event.target.files?.[0];
    saveUploadFile(slot, file, source);
    event.target.value = '';
  };
  const openGallery = (slot) => {
    galleryInputRefs.current[slot]?.click();
  };

  return (
    <section className="screen scroll upload-screen">
      <div className="content-pad rise">
        <div className="back-line">
          <BackButton onClick={() => setScreen('home')} />
          <b>Step 1 of 2</b>
        </div>
        <ProgressSteps active={1} />
        <h2 className="screen-title">Your photos</h2>
        <p className="screen-copy">
          {savedUploadsLoading
            ? 'Loading your saved photos...'
            : 'Add your hand photo from the camera or gallery. More angles make the preview feel more like you 💕'}
        </p>

        <div className="upload-list">
          {slots.map((slot) => {
            const upload = uploads[slot.k];
            const done = Boolean(upload);
            return (
              <div
                key={slot.k}
                className={`upload-slot ${done ? 'done' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => openGallery(slot.k)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openGallery(slot.k);
                  }
                }}
              >
                <input
                  ref={(node) => {
                    galleryInputRefs.current[slot.k] = node;
                  }}
                  className="file-input"
                  type="file"
                  accept="image/*"
                  onChange={(event) => handleFile(event, slot.k, 'gallery')}
                />
                <Pattern c1="#FCE9EF" c2="#F6DBE6" className="upload-thumb">
                  {done ? (
                    <>
                      <img src={upload.url} alt="" />
                      <span className={`check-cover ${upload.status === 'error' ? 'error' : ''}`}>
                        {upload.status === 'saving' ? '...' : upload.status === 'error' ? '!' : '✓'}
                      </span>
                    </>
                  ) : (
                    <span className="plus">＋</span>
                  )}
                </Pattern>
                <span className="upload-copy">
                  <span>
                    <b>{slot.t}</b>
                    {slot.required && <em>REQUIRED</em>}
                  </span>
                  <small>{done ? upload.name : slot.d}</small>
                  {done && (
                    <span className={`upload-status ${upload.status || 'saved'}`}>
                      {upload.status === 'saving' ? 'Saving' : upload.status === 'error' ? 'Retry' : 'Saved'}
                    </span>
                  )}
                </span>
                <span className="upload-actions" onClick={(event) => event.stopPropagation()}>
                  <label className="upload-action" aria-label={`${slot.t} from camera`} title="Camera">
                    <CameraIcon />
                    <input
                      className="file-input"
                      type="file"
                      accept="image/*"
                      capture={slot.k === 'face' ? 'user' : 'environment'}
                      onChange={(event) => handleFile(event, slot.k, 'camera')}
                    />
                  </label>
                  <button
                    type="button"
                    className="upload-action"
                    aria-label={`${slot.t} from gallery`}
                    title="Gallery"
                    onClick={() => openGallery(slot.k)}
                  >
                    <GalleryIcon />
                  </button>
                </span>
              </div>
            );
          })}
        </div>

        <div className="tip-card">
          <span>💡</span>
          <p>
            A photo with your hand <b>resting on your chest or near your face</b> helps the AI show the look together
            with your skin tone and outfit.
          </p>
        </div>

        <button
          className="pink-wide-button upload-continue-button"
          disabled={!uploads.hand || uploads.hand.status === 'saving'}
          onClick={() => uploads.hand && uploads.hand.status !== 'saving' && setScreen('inspiration')}
        >
          {uploads.hand?.status === 'saving' ? 'Saving hand photo...' : 'Continue → inspiration'}
        </button>
      </div>
    </section>
  );
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.5 5.5 13.2 4h-3.4L8.5 5.5H5.2A2.2 2.2 0 0 0 3 7.7v8.1A2.2 2.2 0 0 0 5.2 18h13.6a2.2 2.2 0 0 0 2.2-2.2V7.7a2.2 2.2 0 0 0-2.2-2.2h-4.3Z" />
      <circle cx="12" cy="12" r="3.4" />
    </svg>
  );
}

function GalleryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="2.2" />
      <circle cx="9" cy="10" r="1.3" />
      <path d="m6.5 17 4.1-4.2 3 3 1.9-2 2.8 3.2" />
    </svg>
  );
}

function ProgressSteps({ active }) {
  return (
    <div className="progress-steps">
      <span className={active >= 1 ? 'active' : ''} />
      <span className={active >= 2 ? 'active' : ''} />
    </div>
  );
}

function InspirationScreen({ inspLoaded, saveInspoFile, savedCount, setScreen, startGeneration }) {
  const handleFile = (event, source) => {
    const file = event.target.files?.[0];
    saveInspoFile(file, source);
    event.target.value = '';
  };

  return (
    <section className="screen scroll fixed-action-space">
      <div className="content-pad rise">
        <div className="back-line">
          <BackButton onClick={() => setScreen('upload')} />
          <b>Step 2 of 2</b>
        </div>
        <ProgressSteps active={2} />
        <h2 className="screen-title">Add your inspo</h2>
        <p className="screen-copy">
          Drop a photo of the nails you're obsessed with — we'll recreate them <b>exactly</b> on you 💅
        </p>

        <div className={`inspo-drop ${inspLoaded ? 'done' : ''}`}>
          {inspLoaded ? (
            <>
              <img src={inspLoaded.url} alt="" />
              <div className={`big-check ${inspLoaded.status === 'error' ? 'error' : ''}`}>
                {inspLoaded.status === 'saving' ? '...' : inspLoaded.status === 'error' ? '!' : '✓'}
              </div>
              <b>Inspo added</b>
              <span>
                {inspLoaded.name}
                {inspLoaded.status === 'saving' ? ' · saving' : inspLoaded.status === 'error' ? ' · retry upload' : ' · saved'}
              </span>
            </>
          ) : (
            <>
              <div className="add-box">＋</div>
              <b>Upload a nail photo</b>
              <span>Camera roll · screenshot · fresh photo</span>
            </>
          )}
          <span className="inspo-actions">
            <label className="upload-action text-action" title="Camera">
              <CameraIcon />
              <span>Camera</span>
              <input
                className="file-input"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(event) => handleFile(event, 'camera')}
              />
            </label>
            <label className="upload-action text-action" title="Gallery">
              <GalleryIcon />
              <span>Gallery</span>
              <input
                className="file-input"
                type="file"
                accept="image/*"
                onChange={(event) => handleFile(event, 'gallery')}
              />
            </label>
          </span>
        </div>

        <Divider>or pick a saved one</Divider>

        <button className="moodboard-row" onClick={() => setScreen('search')}>
          <span>♥</span>
          <span>
            <b>From your moodboard</b>
            <small>{savedCount} saved ideas</small>
          </span>
          <em>›</em>
        </button>
      </div>
      <FixedAction>
        <button className="pink-wide-button" onClick={startGeneration}>
          ✨ Generate the look · 1 credit
        </button>
      </FixedAction>
    </section>
  );
}

function SearchScreen({
  query,
  setQuery,
  resultLabel,
  saved,
  savedCount,
  toggleSave,
  setScreen,
  pinterestResults,
  pinterestLoading,
  pinterestError,
  pinterestImportingId,
  runPinterestSearch,
  usePinterestPin,
}) {
  const colA = pinterestResults.filter((_, index) => index % 2 === 0);
  const colB = pinterestResults.filter((_, index) => index % 2 === 1);
  const doSearch = () => runPinterestSearch(query || 'nails');
  const trends = ['Chrome', 'Glazed donut', 'French', 'Cat eye', 'Aura', 'Milky white'];

  return (
    <section className="screen scroll tabs-space">
      <div className="content-pad rise">
        <h2 className="search-title">Explore inspiration</h2>
        <p className="search-sub">Search, save to moodboard, send to generation.</p>

        <div className="search-row">
          <label>
            <SearchIcon />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. chrome, french, cat eye…" />
          </label>
          <button onClick={doSearch}>Search</button>
        </div>

        <div className="trend-row">
          {trends.map((trend) => (
            <button
              key={trend}
              onClick={() => {
                setQuery(trend);
                void runPinterestSearch(trend);
              }}
            >
              {trend}
            </button>
          ))}
        </div>

        <div className="pinterest-label">
          <span>P</span>
          Pinterest results · "{resultLabel}"
        </div>

        {pinterestLoading && <div className="search-status">Loading Pinterest…</div>}
        {!pinterestLoading && pinterestError && <div className="search-status search-status-error">{pinterestError}</div>}

        {!pinterestLoading && !pinterestError && pinterestResults.length > 0 && (
          <div className="masonry">
            {[colA, colB].map((col, colIndex) => (
              <div key={colIndex}>
                {col.map((pin) => {
                  const isSaved = Boolean(saved[pin.id]);
                  const isImporting = pinterestImportingId === pin.id;
                  return (
                    <article key={pin.id} className="pin-tile">
                      <button className="pin-visual" onClick={() => usePinterestPin(pin)}>
                        <div className="pin-media" style={pin.aspectRatio ? { aspectRatio: `${1 / pin.aspectRatio}` } : undefined}>
                          <img src={pin.imageUrl} alt={pin.title} loading="lazy" />
                        </div>
                        <span className={`heart ${isSaved ? 'saved' : ''}`}>♥</span>
                      </button>

                      <div className="pin-copy">
                        <b>{pin.title}</b>
                        <a href={pin.pinUrl} target="_blank" rel="noreferrer">
                          Open pin
                        </a>
                      </div>

                      <div className="pin-actions">
                        <button className={isSaved ? 'active' : ''} onClick={() => toggleSave(pin)}>
                          {isSaved ? 'Saved' : 'Save'}
                        </button>
                        <button onClick={() => usePinterestPin(pin)} disabled={isImporting}>
                          {isImporting ? 'Adding…' : 'Use'}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
      {savedCount > 0 && (
        <div className="saved-bar">
          <b>♥ {savedCount} saved to moodboard</b>
          <button onClick={() => setScreen('upload')}>Use to generate →</button>
        </div>
      )}
    </section>
  );
}

function GeneratingScreen({ progress }) {
  return (
    <section className="screen generating-screen">
      <div className="spinner-wrap">
        <div className="spinner-track" />
        <div className="spinner-ring" />
        <span>💅</span>
      </div>
      <h2>Creating your look…</h2>
      <p>Matching your inspo 1:1 onto your uploaded photos</p>
      <div className="progress-bar">
        <span style={{ width: `${progress}%` }} />
      </div>
      <small>Rendering lights and angles…</small>
    </section>
  );
}

function ResultsScreen({
  gallery,
  setGallery,
  resultItems,
  savedShots,
  saveShot,
  saveAllShots,
  downloadShot,
  shareLook,
  setScreen,
  startGeneration,
  galleryPrev,
  galleryNext,
  startDrag,
  endDrag,
  cancelDrag,
}) {
  const resultsRef = useRef(null);
  const stopActionDrag = (event) => event.stopPropagation();

  useEffect(() => {
    const node = resultsRef.current;
    if (!node) return undefined;

    const preventBrowserScroll = (event) => event.preventDefault();
    node.addEventListener('touchmove', preventBrowserScroll, { passive: false });

    return () => node.removeEventListener('touchmove', preventBrowserScroll);
  }, []);

  return (
    <section className="screen results-screen" ref={resultsRef}>
      <div className="results-head">
        <BackButton onClick={() => setScreen('home')} />
        <b>Your look</b>
        <button className="circle-button" onClick={startGeneration} aria-label="Regenerate">
          ↻
        </button>
      </div>

      <div
        className="gallery-frame"
        onMouseDown={startDrag}
        onMouseUp={endDrag}
        onTouchStart={startDrag}
        onTouchEnd={endDrag}
        onTouchCancel={cancelDrag}
      >
        <div className="gallery-stack" style={{ transform: `translateY(-${gallery * 100}%)` }}>
          {resultItems.map((shot, index) => {
            const isSaved = Boolean(savedShots[index]);
            const shotContent = (
              <>
                {shot.imageUrl ? (
                  <img className="result-image" src={shot.imageUrl} alt="" draggable="false" />
                ) : (
                  <span className="mono-placeholder">[ {shot.ph} ]</span>
                )}
                <div className="shot-actions">
                  <button
                    className={isSaved ? 'saved' : ''}
                    onMouseDown={stopActionDrag}
                    onMouseUp={stopActionDrag}
                    onTouchStart={stopActionDrag}
                    onTouchEnd={stopActionDrag}
                    onClick={(event) => {
                      event.stopPropagation();
                      saveShot(index);
                    }}
                    aria-label={isSaved ? 'Remove preview from gallery' : 'Save preview to gallery'}
                  >
                    ♥
                  </button>
                  <button
                    onMouseDown={stopActionDrag}
                    onMouseUp={stopActionDrag}
                    onTouchStart={stopActionDrag}
                    onTouchEnd={stopActionDrag}
                    onClick={(event) => {
                      event.stopPropagation();
                      downloadShot(index);
                    }}
                    aria-label="Download preview"
                  >
                    <DownloadIcon />
                  </button>
                </div>
              </>
            );

            return shot.imageUrl ? (
              <div key={shot.id} className="result-shot real-result-shot">
                {shotContent}
              </div>
            ) : (
              <Pattern key={shot.id} c1={shot.c1} c2={shot.c2} className="result-shot">
                {shotContent}
              </Pattern>
            );
          })}
        </div>
        <button className="gallery-arrow top" onClick={galleryPrev}>
          ⌃
        </button>
        <button className="gallery-arrow bottom" onClick={galleryNext}>
          ⌄
        </button>
        <div className="gallery-dots">
          {resultItems.map((shot, index) => (
            <button
              key={shot.id}
              className={index === gallery ? 'active' : ''}
              onClick={() => setGallery(index)}
              aria-label={`Go to shot ${index + 1}`}
            />
          ))}
        </div>
      </div>

      <div className="swipe-copy">Swipe up & down to compare previews · {gallery + 1} / {resultItems.length}</div>
      <div className="results-actions">
        <button onClick={saveAllShots}>♥ Save all</button>
        <button onClick={shareLook}>Share / book</button>
      </div>
    </section>
  );
}

function PaywallScreen({ selectedPkg, setSelectedPkg, startCreditCheckout, setScreen }) {
  const selected = packageDefs.find((pkg) => pkg.id === selectedPkg) || packageDefs[1];
  return (
    <section className="screen scroll paywall-screen">
      <div className="content-pad rise">
        <div className="modal-head">
          <BackButton onClick={() => setScreen('home')} />
          <b>Top up</b>
          <span />
        </div>

        <div className="paywall-title">
          <div>💎</div>
          <h2>Buy credits</h2>
          <p>1 credit = 1 try-on. Credits are added after payment is confirmed.</p>
        </div>

        <div className="package-list">
          {packageDefs.map((pkg) => {
            const active = selectedPkg === pkg.id;
            return (
              <button
                key={pkg.id}
                className={`package-card ${active ? 'active' : ''}`}
                onClick={() => setSelectedPkg(pkg.id)}
              >
                {pkg.popular && <span className="best-value">BEST VALUE</span>}
                <span className="pkg-left">
                  <em style={{ background: pkg.iconBg }}>{pkg.icon}</em>
                  <span>
                    <b>{pkg.credits} credits</b>
                    <small>{pkg.per}</small>
                  </span>
                </span>
                <span className="pkg-price">
                  <b>{pkg.price}</b>
                  <i>{active && <span />}</i>
                </span>
              </button>
            );
          })}
        </div>

        <div className="payment-card">
          <div>
            <span>Pay with</span>
            <b>Stripe</b>
          </div>
          <div className="pay-methods">
            {['Card', 'iDEAL', 'Apple Pay', 'Google Pay'].map((method) => (
              <span key={method}>{method}</span>
            ))}
          </div>
        </div>

        <button className="dark-wide-button pay-button" onClick={startCreditCheckout}>
          Pay {selected.price} securely →
        </button>
        <div className="secure-copy">🔒 Credits unlock only after Stripe confirms payment</div>
      </div>
    </section>
  );
}

function AccountScreen({ credits, savedCount, currentUser, handleLogout, setScreen }) {
  const displayName = currentUser?.full_name || currentUser?.display_name || currentUser?.email?.split('@')[0] || 'Julia Rossi';
  const displayEmail = currentUser?.email || 'julia@email.com';
  const initial = (displayName || displayEmail || 'J').trim()[0]?.toUpperCase() || 'J';

  return (
    <section className="screen scroll tabs-space">
      <div className="content-pad rise">
        <div className="profile-head">
          <div>{initial}</div>
          <span>
            <b>{displayName}</b>
            <small>{displayEmail}</small>
          </span>
        </div>

        <div className="stats-row">
          <span>
            <b>{credits}</b>
            <small>Credits</small>
          </span>
          <span>
            <b>{savedCount}</b>
            <small>Saved</small>
          </span>
          <span>
            <b>12</b>
            <small>Try-ons</small>
          </span>
        </div>

        <button className="pink-wide-button buy-button" onClick={() => setScreen('paywall')}>
          + Buy more credits
        </button>

        <h2 className="gallery-title">My gallery</h2>
        <div className="gallery-grid">
          {galleryItems.map((item) => (
            <button key={item.t} onClick={() => setScreen('results')}>
              <Pattern c1={item.c1} c2={item.c2}>
                <span>{item.tag}</span>
              </Pattern>
              <b>{item.t}</b>
            </button>
          ))}
        </div>

        <div className="menu-card">
          {menuItems.map((item) => (
            <button key={item}>
              <span>{item}</span>
              <em>›</em>
            </button>
          ))}
        </div>

        <button className="outline-pink-button logout" onClick={handleLogout}>
          Log out
        </button>
      </div>
    </section>
  );
}

function FixedAction({ children }) {
  return <div className="fixed-action">{children}</div>;
}

function TabBar({ screen, setScreen }) {
  const color = (name) => (screen === name ? PINK : MUTED);
  return (
    <nav className="tab-bar" aria-label="Primary">
      <button onClick={() => setScreen('home')}>
        <HomeIcon color={color('home')} />
        <span style={{ color: color('home') }}>Home</span>
      </button>
      <button onClick={() => setScreen('search')}>
        <SearchIcon color={color('search')} />
        <span style={{ color: color('search') }}>Explore</span>
      </button>
      <button className="create-tab" onClick={() => setScreen('upload')}>
        <span>
          <PlusIcon />
        </span>
        <em>Create</em>
      </button>
      <button onClick={() => setScreen('paywall')}>
        <CreditIcon color={color('paywall')} />
        <span style={{ color: color('paywall') }}>Credits</span>
      </button>
      <button onClick={() => setScreen('account')}>
        <UserIcon color={color('account')} />
        <span style={{ color: color('account') }}>Profile</span>
      </button>
    </nav>
  );
}

function SearchIcon({ color = '#9B6FC9' }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
    </svg>
  );
}

function GoogleLogo() {
  return (
    <svg className="google-logo" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"
      />
      <path
        fill="#4285F4"
        d="M46.5 24.5c0-1.57-.14-3.08-.41-4.5H24v9.02h12.63c-.54 2.92-2.18 5.39-4.65 7.05l7.18 5.57C43.36 37.77 46.5 32.08 46.5 24.5Z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59A14.45 14.45 0 0 1 9.75 24c0-1.59.28-3.13.78-4.59l-7.98-6.19A23.93 23.93 0 0 0 0 24c0 3.86.92 7.5 2.56 10.78l7.97-6.19Z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.92-2.13 15.89-5.81l-7.18-5.57c-1.99 1.34-4.53 2.13-8.71 2.13-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.18C6.51 42.62 14.62 48 24 48Z"
      />
      <path fill="none" d="M0 0h48v48H0z" />
    </svg>
  );
}

function AppleLogo() {
  return (
    <svg className="apple-logo" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.05 12.53c-.03-2.72 2.22-4.04 2.32-4.1-1.27-1.85-3.24-2.1-3.92-2.13-1.65-.17-3.25.99-4.09.99-.86 0-2.16-.97-3.56-.94-1.8.03-3.49 1.07-4.42 2.7-1.91 3.31-.49 8.17 1.35 10.84.92 1.31 1.99 2.78 3.38 2.73 1.37-.06 1.88-.87 3.53-.87 1.64 0 2.12.87 3.56.84 1.46-.03 2.39-1.32 3.27-2.65 1.06-1.5 1.49-2.98 1.5-3.05-.03-.01-2.89-1.1-2.92-4.36ZM14.37 4.55c.74-.92 1.24-2.16 1.1-3.43-1.07.05-2.42.74-3.19 1.63-.69.8-1.31 2.09-1.15 3.31 1.21.09 2.47-.61 3.24-1.51Z" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#D9893C" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <rect x="13" y="3" width="8" height="8" rx="2" />
      <rect x="3" y="13" width="8" height="8" rx="2" />
      <rect x="13" y="13" width="8" height="8" rx="2" />
    </svg>
  );
}

function HomeIcon({ color }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 11l8-6 8 6" />
      <path d="M6 10v9h12v-9" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function CreditIcon({ color }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="6" width="20" height="13" rx="3" />
      <line x1="2" y1="11" x2="22" y2="11" />
    </svg>
  );
}

function UserIcon({ color }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3A2932" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="M7 11l5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  );
}

export default App;
