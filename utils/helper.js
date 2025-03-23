/**
 * Get the frontend URL based on environment
 * @returns {string} Frontend URL
 */
const getFrontendURL = () => {
    if (process.env.NODE_ENV === 'production') {
      return process.env.FRONTEND_URL || 'https://your-production-url.com';
    }
    return process.env.FRONTEND_URL || 'http://localhost:5173';
  };
  
  /**
   * Build URL with query parameters
   * @param {string} baseUrl - Base URL
   * @param {Object} params - Query parameters
   * @returns {string} URL with query parameters
   */
  const buildUrl = (baseUrl, params = {}) => {
    const url = new URL(baseUrl);
    Object.keys(params).forEach(key => {
      if (params[key] !== undefined && params[key] !== null) {
        url.searchParams.append(key, params[key]);
      }
    });
    return url.toString();
  };
  
  module.exports = {
    getFrontendURL,
    buildUrl
  };