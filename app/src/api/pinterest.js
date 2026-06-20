import { base44 } from './base44Client';

export async function searchPinterest(query, options = {}) {
  const response = await base44.functions.invoke('pinterestSearch', {
    query,
    limit: options.limit,
  });

  const data = response?.data || response;
  return {
    query: data?.query || query,
    results: Array.isArray(data?.results) ? data.results : [],
    count: Number(data?.count) || 0,
  };
}

export async function importPinterestImage(pin) {
  const response = await base44.functions.invoke('importPinterestImage', {
    imageUrl: pin.imageUrl,
    pinUrl: pin.pinUrl,
    title: pin.title,
  });

  const data = response?.data || response;
  return {
    upload: data?.upload || null,
    signedUrl: data?.signedUrl || '',
    pinUrl: data?.pinUrl || pin.pinUrl,
    imageUrl: data?.imageUrl || pin.imageUrl,
  };
}
