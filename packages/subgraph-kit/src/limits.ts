// The router batches every entity a query needs into one request, and a real query needs far
// fewer. More is a forged request trying to multiply upstream calls. Each source's queue holds as
// many, so a real batch on a cold cache doesn't overflow it.
export const MAX_REPRESENTATIONS = 500;
