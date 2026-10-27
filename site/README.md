# Netlify Deployment

This site is configured for Netlify deployment. 

## Deployment Steps

1. Connect your Git repo to Netlify
2. Set build directory to `site/` 
3. Set publish directory to `site/`
4. Deploy

Or use the Netlify CLI:
```bash
npm install -g netlify-cli
netlify deploy --dir=site --prod
```

## Custom Domain

Add your custom domain in Netlify settings. The demo link in the site points to `https://driftpdf.app` - update this if needed.
