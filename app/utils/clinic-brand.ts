const primaryPalettes = new Set(['brand', 'teal', 'indigo', 'violet', 'rose', 'emerald'])

export function clinicBrand(primary: string, logo: string) {
  return {
    primary: primaryPalettes.has(primary) ? primary : 'brand',
    logo: /^\/branding\/[a-z0-9_-]+\.(svg|png|webp)$/.test(logo)
      ? logo
      : '/favicon.svg'
  }
}
