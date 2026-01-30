/**
 * Centralized business data constants for Owl Internet.
 * Single source of truth for all business information.
 */

// Company Information
export const COMPANY_INFO = {
  name: 'Owl Internet',
  founded: '2018',
  serviceAreas: 'Nationwide fiber and cable internet',
  phone: '1-800-OWL-HELP',
  email: 'help@owlinternet.com',
  website: 'owlinternet.com',
  hours: '24/7 customer support',
};

// Internet Plans
export interface InternetPlan {
  name: string;
  speed: string;
  price: string;
  description: string;
}

export const INTERNET_PLANS: Record<string, InternetPlan> = {
  '100': {
    name: 'Basic',
    speed: 'one hundred megabits per second',
    price: 'thirty-nine dollars and ninety-nine cents per month',
    description: 'Perfect for browsing and streaming',
  },
  '300': {
    name: 'Standard',
    speed: 'three hundred megabits per second',
    price: 'fifty-nine dollars and ninety-nine cents per month',
    description: 'Great for families and remote work',
  },
  '500': {
    name: 'Advanced',
    speed: 'five hundred megabits per second',
    price: 'seventy-four dollars and ninety-nine cents per month',
    description: 'High-speed for power users',
  },
  '1000': {
    name: 'Premium',
    speed: 'one thousand megabits per second',
    price: 'eighty-nine dollars and ninety-nine cents per month',
    description: 'Ultra-fast for heavy usage and gaming',
  },
  '1gig': {
    name: 'Premium',
    speed: 'one thousand megabits per second',
    price: 'eighty-nine dollars and ninety-nine cents per month',
    description: 'Ultra-fast for heavy usage and gaming',
  },
  gigabit: {
    name: 'Premium',
    speed: 'one thousand megabits per second',
    price: 'eighty-nine dollars and ninety-nine cents per month',
    description: 'Ultra-fast for heavy usage and gaming',
  },
};

// Router Information
export interface RouterModel {
  maxSpeed: string;
  wifiStandard: string;
  upgradeNeeded: string;
  upgradeCost: string;
}

export const ROUTER_MODELS: Record<string, RouterModel> = {
  'OWL-R2021': {
    maxSpeed: 'three hundred megabits per second',
    wifiStandard: 'WiFi 5',
    upgradeNeeded:
      'For speeds above three hundred megabits per second, upgrade to X5 router recommended',
    upgradeCost: 'one hundred dollars (or twenty-five dollars for loyal customers)',
  },
  'OWL-R2019': {
    maxSpeed: 'one hundred fifty megabits per second',
    wifiStandard: 'WiFi 5',
    upgradeNeeded: 'Router is limiting your plan speeds. X5 upgrade strongly recommended',
    upgradeCost: 'one hundred dollars (or twenty-five dollars for loyal customers)',
  },
  'OWL-X5': {
    maxSpeed: 'one thousand plus megabits per second',
    wifiStandard: 'WiFi 6',
    upgradeNeeded: 'Latest model - no upgrade needed',
    upgradeCost: 'Not applicable',
  },
};

// Loyalty Tiers
export const LOYALTY_TIERS = {
  new: '0-1 years',
  loyal: '2-4 years',
  premium: '5+ years',
};

// Promotions and Discounts
export const PROMOTIONS = {
  autopayDiscount: 'fifteen dollars per month off any plan upgrade',
  loyaltyDiscount2yr: 'ten percent off monthly rate',
  loyaltyDiscount5yr: 'twenty percent off monthly rate',
  retentionOffer: 'fifty percent off first six months',
};

// Standard Test Phone Numbers (legacy support)
export const TEST_PHONE_NUMBERS = {
  genericTest: '+15551234567',
};
