// Session lifecycle.

import { Router } from 'express';

const router = Router();

// POST, not GET: signing out changes state, so it must not be triggerable by
// a link, a prefetch or an <img> tag on another site.
router.post('/signout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('amfa.sid');
    res.redirect('/');
  });
});

export default router;
