# Launch posts

Drafts and notes for the launch in [#162](https://github.com/NC4321/SignalPlan/issues/162), scoped by [D87](../DECISIONS.md#d87-scope-for-phase-9-polish-documentation-and-launch--2026-10-04). The author posts them; nothing here is posted automatically.

| File                                                 | Venue                                                       | Audience                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------- |
| [reddit-homenetworking.md](reddit-homenetworking.md) | [r/HomeNetworking](https://www.reddit.com/r/HomeNetworking) | People sorting out Wi-Fi in their own home                      |
| [reddit-homelab.md](reddit-homelab.md)               | [r/homelab](https://www.reddit.com/r/homelab)               | Tinkerers who run their own kit and like to see how things work |
| [show-hn.md](show-hn.md)                             | [Show HN](https://news.ycombinator.com/show)                | Developers, comfortable with dB, who will read the write-up     |

## Order

1. **Wait for the exit gate.** D87 puts the launch after first-time users ([#77](https://github.com/NC4321/SignalPlan/issues/77)) and the exit gate ([#163](https://github.com/NC4321/SignalPlan/issues/163)).
2. **Reddit first.** r/HomeNetworking and r/homelab are the people the tool is for, so their feedback comes before the developer audience (D87). Post to one, then the other a day or more later, so you can answer every comment. [AUTHOR: pick which sub goes first and the days]
3. **File what comes up.** Each bug, confusion or missing feature gets an issue; the important ones are fixed before Show HN (#162's second checkbox).
4. **Then Show HN**, linking the app and [the write-up](../writeup.md). Update the write-up first if Reddit turned up anything it gets wrong.
5. **Keep notes** on what people said in [Notes](#notes-on-what-people-said) below (#162's third checkbox).

## Rules, venue by venue

Checked on **2026-10-05**. Reddit and news.ycombinator.com were blocked from the environment that drafted these, so the rules below come from web search results that quote or summarise those pages, not from loading the pages themselves. **Treat every rule here as unconfirmed until you've read the live page**, and fill in the "Confirmed" column when you have.

### r/HomeNetworking

| Rule                                                                                                                                                                                                                                                                                                                                   | Source                                                                                                                                                                                                                                                   | Confirmed                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| **Self-promotion has been forbidden in all forms.** A moderator post said so, and that the team was discussing relaxing it and wanted the community's views.                                                                                                                                                                           | Search-result summary of the sub's front page (a Redlib mirror of r/HomeNetworking). The post's date and whether the change was adopted were not visible.                                                                                                | No [AUTHOR: confirm]            |
| **The proposed relaxation:** a self-promotional post would be allowed if it's a text post, on a relevant topic that promotes education or discussion, with enough content to understand without leaving Reddit, linking back to your own site at the bottom, with **no AI-generated content** and no links to store or purchase pages. | Same search-result summary.                                                                                                                                                                                                                              | No: proposal, status unknown    |
| An older posting-guidelines post bans Amazon affiliate links, bans "starting a fresh post with the express intent of product visibility", and says any advertisement made without the moderators' permission is removed and the user permanently banned.                                                                               | [/r/HomeNetworking posting guidelines and helpful resources](https://www.reddit.com/r/HomeNetworking/comments/3hvyg0/rhomenetworking_posting_guidelines_and_helpful/) (seen through a mirror in search results; it's an old post and may be superseded). | No                              |
| Flair requirements.                                                                                                                                                                                                                                                                                                                    | Not found.                                                                                                                                                                                                                                               | No [AUTHOR: check when posting] |

**What this means:** SignalPlan is free, non-commercial and has no store or affiliate links, but it is your own project, and the safest reading of the sub's rule is that it counts as self-promotion. **Message the moderators first** (modmail), say what it is, and ask whether a text post is welcome and with which flair. The draft is written to meet the proposed criteria anyway: a text post that stands on its own, with the link at the bottom. [AUTHOR: record the moderators' answer and the date here]

### r/homelab

| Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Source                                                                                                                                                  | Confirmed                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| **Rule 6, "No Commercial Advertising or Monetized Referral Links".** Monetized referral links, affiliate links, product advertising and company advertising aren't allowed. Non-commercial personal projects are permitted but must follow all the other rules. The moderators said the sub now officially allows some self-promotion and redefined rule 6 to cover only monetized and commercial links. Message the moderators first if you think an exception applies. | [r/homelab rules wiki](https://www.reddit.com/r/homelab/wiki/rules) and the sub's front page, as summarised in search results (through Redlib mirrors). | No [AUTHOR: confirm]            |
| **No low-effort posts or blogspam.** Among the examples: "Links and cross posts without accompanying comment/description". A bare link to the app would break this; a text post with a description shouldn't.                                                                                                                                                                                                                                                            | Same.                                                                                                                                                   | No [AUTHOR: confirm]            |
| A weekly or "self-promotion day" thread, a 9:1 ratio, or flair requirements.                                                                                                                                                                                                                                                                                                                                                                                             | Not found either way.                                                                                                                                   | No [AUTHOR: check when posting] |

**What this means:** a free, MIT, non-commercial project looks allowed under rule 6, as a text post with a real description. Check the live rules and sidebar for flair and any day restriction before posting.

### Show HN

| Rule                                                                                                                                                                                                                                               | Source                                                                                                                                                                                                 | Confirmed                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| Show HN is for something you've made that other people can play with. On topic: things people can run on their computers. **Off topic: blog posts, sign-up pages, newsletters, lists and other reading material** (submit those normally instead). | [Show HN guidelines](https://news.ycombinator.com/showhn.html), quoted in search results.                                                                                                              | Partly: wording quoted, page not loaded |
| The title begins with "Show HN". It must be something you've worked on personally and are around to discuss. It needn't be slick; early work is fine.                                                                                              | Same.                                                                                                                                                                                                  | Partly                                  |
| Make it easy to try, ideally with no sign-up or email. (SignalPlan needs neither.)                                                                                                                                                                 | Same.                                                                                                                                                                                                  | Partly                                  |
| Don't ask friends to upvote or comment.                                                                                                                                                                                                            | Same.                                                                                                                                                                                                  | Partly                                  |
| Titles: no uppercase or exclamation marks for emphasis, and don't say how great it is. Titles are limited to 80 characters.                                                                                                                        | [HN guidelines](https://news.ycombinator.com/newsguidelines.html), quoted in search results; the 80-character limit from HN threads such as [this one](https://news.ycombinator.com/item?id=40677110). | Partly                                  |
| **"Don't post generated comments or AI-edited comments. HN is for conversation between humans."** Reported added to the guidelines in March 2026.                                                                                                  | [HN guidelines](https://news.ycombinator.com/newsguidelines.html), as quoted in search results and news coverage.                                                                                      | No [AUTHOR: confirm]                    |

**What this means:** the Show HN link should be the app ([signalplan.pages.dev](https://signalplan.pages.dev)), since a write-up on its own is reading material, which Show HN puts off topic. The write-up goes in the text. Keep the title plain and under 80 characters.

### These drafts are not your words yet

These drafts were written with an AI assistant, from the repo's docs. HN's guidelines (as quoted above) don't allow generated or AI-edited comments, and r/HomeNetworking's proposed rule excludes AI-generated content. Use them as a checklist of what to say and which numbers are safe, and **write the posts and every reply in your own words**. [AUTHOR: decide whether and how to say that much of the code was written with an AI coding assistant; the commits carry Co-Authored-By trailers, so anyone reading the history will see it, and it's likely to be asked]

## Before posting

- [ ] #77 and the exit gate (#163) are done (D87).
- [ ] The live rules, sidebar and wiki of the sub read today; the tables above updated, with the date.
- [ ] r/HomeNetworking: the moderators messaged and their answer recorded above.
- [ ] The post rewritten in your own words; every `[AUTHOR: …]` filled or removed.
- [ ] Every number in the post checked against [MODEL.md](../MODEL.md) and [the write-up](../writeup.md) as they are on the day (D96: no test ties them).
- [ ] [signalplan.pages.dev](https://signalplan.pages.dev) loads on a fresh browser and a phone, the sample home and guide appear, and a share link opens.
- [ ] The README and write-up still say no real home has been surveyed or scanned (#132, #144), or are updated if one has, and the post matches.
- [ ] Issues are open for feedback, and you have a few hours free after posting to answer comments.
- [ ] Nobody asked to upvote or comment.

## Notes on what people said

One section per post. Copy the template.

<!--
### <Venue> — <date posted>

- Link:
- Score and comments after a day:

**Bugs reported** (each with its issue):

-

**Confusion** (what people misread or couldn't find):

-

**Asked for:**

-

**Doubts about the model** (and whether they're right):

-

**Real-home data offered** (link, and whether it went to #132 or #144):

-

**Changed before the next post:**

-
-->

_No posts yet._
