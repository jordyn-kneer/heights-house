import re
src=open('/tmp/claude-0/-home-claude/1e57f841-806d-5dca-b728-5fd787444047/scratchpad/heights-house.html').read()
head_end=src.index('<script>\n(() => {\n  const lb')
markup=src[:head_end]
router=src[head_end:src.index('(() => {\n  const $ = s =>')]
app=open('src/app.js').read()
def rep(old,new,count=1):
    global markup
    assert markup.count(old)>=1, old[:60]
    markup=markup.replace(old,new,count)
rep('<title>Heights House</title>','''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Heights House · Coworking in Peoria Heights</title>
<meta name="description" content="Heights House is a coworking and gathering space at 1314 E Marietta Ave in Peoria Heights, IL. Desks, private offices, a conference room any local business can book, and events for agents of every brokerage.">
<meta property="og:title" content="Heights House · Peoria Heights, IL">
<meta property="og:description" content="Coworking, a bookable conference room and a calendar full of lunches, trainings and get-togethers. Every brokerage welcome.">
<meta property="og:image" content="/photos/exterior.jpg">
<meta property="og:type" content="website">
<meta name="theme-color" content="#FF5B3A">
<link rel="icon" type="image/png" href="/icon.png">
<link rel="apple-touch-icon" href="/icon.png">''')
markup=markup.replace('</style>','.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}\n#staffBar{background:var(--ink);color:var(--paper);font-family:var(--mono);font-size:.8rem;padding:.5rem 1rem;display:flex;gap:1rem;justify-content:center;align-items:center;flex-wrap:wrap}\n#staffBar a,#staffBar button{color:var(--sun);background:none;border:0;font:inherit;cursor:pointer;text-decoration:underline}\n</style>\n</head>\n<body>\n<div id="staffBar" hidden>Staff view · <a href="#book">Room requests</a><a href="#help">Help requests</a><a href="#host">Pitches</a><a href="#calendar">Calendar</a><button type="button" id="staffOut">Sign out</button></div>',1)
markup=markup.replace('@media (max-width:820px){.cal,.book{grid-template-columns:1fr}','@media (max-width:820px){.cal,.book{grid-template-columns:minmax(0,1fr)}')
markup=markup.replace('#staffBar a,','#staffBar[hidden]{display:none}\n#staffBar a,')
# remove claude-only notices
markup=re.sub(r'\s*<div class="notice" id="(bookNote|tkNote|prNote)" hidden>.*?</div>','',markup)
rep('Membership <span class="tbd">draft pricing</span>','Membership')
# email on booking form
rep('''<div class="field"><label for="b-phone">Phone</label><input id="b-phone" type="tel" autocomplete="tel"></div>
        </div>''','''<div class="field"><label for="b-phone">Phone</label><input id="b-phone" type="tel" autocomplete="tel"></div>
        </div>
        <div class="field"><label for="b-email">Email</label><input id="b-email" type="email" autocomplete="email"></div>''')
for k,form in [('request','bookForm'),('ticket','tkForm'),('proposal','prForm')]:
    rep(f'id="{form}" novalidate>', f'id="{form}" novalidate>\n        <div class="hp" aria-hidden="true"><label>Leave this empty<input id="hp-{k}" tabindex="-1" autocomplete="off"></label></div>')
rep("and you'll see the status change below.","and you'll see the status change below on this device.")
# staff sign-in view before footer
staff='''<section id="staff" data-view="staff"><div class="wrap" style="max-width:560px">
  <div class="head">
    <a class="back" href="#top">← Back to home</a>
    <p class="eyebrow">Staff</p>
    <h2>Staff sign-in</h2>
    <p>For Jordyn and Jordan. Sign in to approve room requests, handle help requests, review pitches and add events.</p>
  </div>
  <div class="panel">
    <form class="stack" id="staffForm" novalidate>
      <div class="field"><label for="staff-key">Passcode</label><input id="staff-key" type="password" autocomplete="current-password" required></div>
      <button class="sbtn" type="submit" id="staff-submit">Sign in</button>
      <p class="msg" id="staff-msg" role="status"></p>
    </form>
  </div>
</div></section>
'''
rep('<footer>', staff+'<footer>')
rep('<a href="#help">Need something? Send a request</a>','<span style="display:flex;gap:1.2rem;flex-wrap:wrap"><a href="#help">Need something? Send a request</a><a href="#staff">Staff</a></span>')
router=router.replace("book:'book'}","book:'book', staff:'staff'}")
assert "staff:'staff'" in router
out=markup+router+'(() => {})();\n</script>\n<script>\n'+app+'</script>\n</body>\n</html>\n'
assert 'claude' not in out.lower(), [m.start() for m in re.finditer('claude',out.lower())]
open('public/index.html','w').write(out)
print(len(out))
