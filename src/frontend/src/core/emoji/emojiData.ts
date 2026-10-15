/**
 * core/emoji/emojiData.ts
 * ---------------------------------------------------------------------------
 * The emoji set the shared picker offers (demo-feedback story 12, DF-15). A small,
 * BUNDLED, hand-picked list of common emoji, weighted toward what a PIO or a member
 * of the public posts during an incident (alerts, weather, responders, shelters,
 * pets, supplies) alongside the everyday faces, gestures and hearts.
 *
 * WHY HAND-ROLLED (DF-15). Exercise networks are locked down: the picker must make
 * NO runtime network request and must render NATIVE emoji (the OS font draws them,
 * no image sprites). This list is plain text compiled into the bundle, so there is
 * nothing to fetch, nothing to cache, and no third-party data to self-host. The
 * library candidates checked on 10/14 either fetch their data from a CDN by default
 * (frimousse) or were a days-old major with a 50 MB package (emoji-picker-react 5).
 *
 * GRID ALIGNMENT. The picker lays emoji out in {@link EMOJI_COLUMNS} columns and its
 * arrow keys move through ONE flat list (Up/Down = +/- a row). Every category holds
 * a multiple of {@link EMOJI_COLUMNS} entries, so each category starts a fresh row
 * and Up/Down land on the emoji visually above/below even across category headings.
 * `emojiData.test.ts` enforces this; keep it true when editing the list.
 *
 * SUPPORT. Entries are Unicode 13 or earlier and avoid skin-tone and ZWJ sequences,
 * so Windows 10/11 (Segoe UI Emoji), macOS/iOS and Android all draw them natively.
 * A few carry the U+FE0F presentation selector (e.g. the red heart); the composer
 * counts code points, so those count as two characters, exactly as if typed.
 *
 * Each entry is `[emoji, name, extra search keywords]`; the name doubles as the
 * option's accessible name in the picker.
 */

/** Columns in the picker grid. Every category length is a multiple of this. */
export const EMOJI_COLUMNS = 8

export interface EmojiEntry {
  /** The emoji itself (native text, inserted verbatim). */
  readonly emoji: string
  /** Lower-case CLDR-style name; the option's accessible name. */
  readonly name: string
  /** Extra lower-case search words (synonyms people type). */
  readonly keywords: readonly string[]
}

export interface EmojiCategory {
  /** Stable id (used in element ids). */
  readonly id: string
  /** Visible heading. */
  readonly label: string
  readonly emoji: readonly EmojiEntry[]
}

type Row = readonly [emoji: string, name: string, keywords?: string]

function category(id: string, label: string, rows: readonly Row[]): EmojiCategory {
  return {
    id,
    label,
    emoji: rows.map(([emoji, name, keywords = '']) => ({
      emoji,
      name,
      keywords: keywords.split(' ').filter(word => word.length > 0),
    })),
  }
}

export const EMOJI_CATEGORIES: readonly EmojiCategory[] = [
  category('smileys', 'Smileys', [
    ['😀', 'grinning face', 'happy smile'],
    ['😃', 'grinning face with big eyes', 'happy smile'],
    ['😄', 'grinning face with smiling eyes', 'happy smile'],
    ['😁', 'beaming face with smiling eyes', 'happy grin'],
    ['😅', 'grinning face with sweat', 'relief phew'],
    ['😂', 'face with tears of joy', 'laugh lol funny'],
    ['🤣', 'rolling on the floor laughing', 'laugh rofl lol funny'],
    ['😊', 'smiling face with smiling eyes', 'blush happy'],
    ['😇', 'smiling face with halo', 'angel innocent'],
    ['🙂', 'slightly smiling face', 'smile'],
    ['😉', 'winking face', 'wink'],
    ['😍', 'smiling face with heart-eyes', 'love'],
    ['🥰', 'smiling face with hearts', 'love'],
    ['😘', 'face blowing a kiss', 'kiss love'],
    ['😋', 'face savoring food', 'yum delicious'],
    ['😎', 'smiling face with sunglasses', 'cool'],
    ['🤔', 'thinking face', 'hmm think'],
    ['🤨', 'face with raised eyebrow', 'skeptical doubt'],
    ['😐', 'neutral face', 'meh'],
    ['😑', 'expressionless face', 'blank'],
    ['🙄', 'face with rolling eyes', 'eyeroll'],
    ['😏', 'smirking face', 'smirk'],
    ['😬', 'grimacing face', 'awkward yikes'],
    ['😮', 'face with open mouth', 'wow surprised'],
    ['😲', 'astonished face', 'shocked surprised'],
    ['😳', 'flushed face', 'embarrassed'],
    ['🥺', 'pleading face', 'please'],
    ['😢', 'crying face', 'sad tear'],
    ['😭', 'loudly crying face', 'sob sad'],
    ['😤', 'face with steam from nose', 'frustrated'],
    ['😠', 'angry face', 'mad'],
    ['😡', 'pouting face', 'rage angry mad'],
    ['😱', 'face screaming in fear', 'scared shock'],
    ['🤯', 'exploding head', 'mind blown shocked'],
    ['😴', 'sleeping face', 'sleep tired zzz'],
    ['😷', 'face with medical mask', 'sick mask flu'],
    ['🤒', 'face with thermometer', 'sick fever ill'],
    ['🤢', 'nauseated face', 'sick'],
    ['🥵', 'hot face', 'heat hot sweating'],
    ['🥶', 'cold face', 'freezing cold'],
  ]),
  category('people', 'People and gestures', [
    ['👍', 'thumbs up', 'like yes ok agree +1'],
    ['👎', 'thumbs down', 'dislike no disagree'],
    ['👏', 'clapping hands', 'applause clap bravo'],
    ['🙌', 'raising hands', 'celebrate hooray'],
    ['🙏', 'folded hands', 'please thanks thank you pray'],
    ['🤝', 'handshake', 'deal agreement partnership'],
    ['👋', 'waving hand', 'hello hi bye wave'],
    ['👌', 'ok hand', 'okay perfect'],
    ['✌️', 'victory hand', 'peace'],
    ['🤞', 'crossed fingers', 'luck hope'],
    ['💪', 'flexed biceps', 'strong strength'],
    ['👊', 'oncoming fist', 'fist bump'],
    ['✊', 'raised fist', 'solidarity'],
    ['🤷', 'person shrugging', 'shrug idk'],
    ['🤦', 'person facepalming', 'facepalm'],
    ['🙋', 'person raising hand', 'question volunteer'],
    ['👀', 'eyes', 'look watching see'],
    ['🧠', 'brain', 'smart think'],
    ['👂', 'ear', 'listen hear'],
    ['🗣️', 'speaking head', 'speak announce say'],
    ['👥', 'busts in silhouette', 'people community group'],
    ['👪', 'family', 'parents kids'],
    ['👷', 'construction worker', 'crew utility worker'],
    ['👮', 'police officer', 'police cop law enforcement'],
  ]),
  category('symbols', 'Hearts and symbols', [
    ['❤️', 'red heart', 'love'],
    ['🧡', 'orange heart', 'love'],
    ['💛', 'yellow heart', 'love'],
    ['💚', 'green heart', 'love'],
    ['💙', 'blue heart', 'love'],
    ['💜', 'purple heart', 'love'],
    ['🖤', 'black heart', 'love mourning'],
    ['💔', 'broken heart', 'sad heartbreak'],
    ['✅', 'check mark button', 'done yes ok complete'],
    ['✔️', 'check mark', 'done yes ok'],
    ['❌', 'cross mark', 'no wrong cancel'],
    ['❗', 'exclamation mark', 'important attention'],
    ['❓', 'question mark', 'question'],
    ['‼️', 'double exclamation mark', 'important urgent'],
    ['💯', 'hundred points', '100 perfect'],
    ['⭐', 'star', 'favorite'],
    ['✨', 'sparkles', 'new shiny'],
    ['🎉', 'party popper', 'celebrate congrats party'],
    ['💬', 'speech balloon', 'comment chat message'],
    ['📢', 'loudspeaker', 'announcement public address'],
    ['📣', 'megaphone', 'announce announcement'],
    ['🔔', 'bell', 'notification alert'],
    ['ℹ️', 'information', 'info'],
    ['🆘', 'sos button', 'help emergency'],
  ]),
  category('emergency', 'Emergency and safety', [
    ['🚨', 'police car light', 'siren alert emergency'],
    ['⚠️', 'warning', 'caution alert danger'],
    ['⛔', 'no entry', 'closed stop'],
    ['🚫', 'prohibited', 'banned no forbidden'],
    ['🛑', 'stop sign', 'stop'],
    ['🚧', 'construction', 'roadwork barrier closed detour'],
    ['🔥', 'fire', 'wildfire burn flame hot'],
    ['🧯', 'fire extinguisher', 'fire safety'],
    ['🚒', 'fire engine', 'firetruck fire department'],
    ['🚑', 'ambulance', 'ems medical paramedic'],
    ['🚓', 'police car', 'police patrol'],
    ['🚁', 'helicopter', 'rescue medevac'],
    ['🏥', 'hospital', 'medical er emergency room'],
    ['⛑️', "rescue worker's helmet", 'first aid rescue'],
    ['🩹', 'adhesive bandage', 'first aid injury'],
    ['💊', 'pill', 'medicine medication'],
    ['🩺', 'stethoscope', 'doctor medical health'],
    ['💉', 'syringe', 'vaccine shot injection'],
    ['☣️', 'biohazard', 'hazmat contamination'],
    ['☢️', 'radioactive', 'radiation hazmat nuclear'],
    ['🔦', 'flashlight', 'torch power outage'],
    ['🔋', 'battery', 'power charge'],
    ['📡', 'satellite antenna', 'signal communications'],
    ['📻', 'radio', 'broadcast news'],
  ]),
  category('weather', 'Weather and nature', [
    ['☀️', 'sun', 'sunny clear'],
    ['🌤️', 'sun behind small cloud', 'mostly sunny'],
    ['⛅', 'sun behind cloud', 'partly cloudy'],
    ['☁️', 'cloud', 'cloudy overcast'],
    ['🌧️', 'cloud with rain', 'rain rainy'],
    ['⛈️', 'cloud with lightning and rain', 'thunderstorm storm'],
    ['🌩️', 'cloud with lightning', 'lightning storm'],
    ['⚡', 'high voltage', 'lightning power electric'],
    ['❄️', 'snowflake', 'snow cold winter'],
    ['🌨️', 'cloud with snow', 'snow storm blizzard'],
    ['🌪️', 'tornado', 'twister storm'],
    ['🌀', 'cyclone', 'hurricane typhoon storm'],
    ['🌊', 'water wave', 'flood tsunami surge ocean'],
    ['💧', 'droplet', 'water drop'],
    ['☔', 'umbrella with rain drops', 'rain'],
    ['🌡️', 'thermometer', 'temperature heat'],
    ['🌫️', 'fog', 'foggy visibility'],
    ['💨', 'dashing away', 'wind gust'],
    ['🌈', 'rainbow', 'weather'],
    ['🌋', 'volcano', 'eruption'],
    ['🏔️', 'snow-capped mountain', 'mountain'],
    ['🌲', 'evergreen tree', 'tree forest'],
    ['🌳', 'deciduous tree', 'tree park'],
    ['🌎', 'globe showing americas', 'world earth'],
  ]),
  category('places', 'Places and things', [
    ['🏠', 'house', 'home'],
    ['🏢', 'office building', 'office work'],
    ['🏫', 'school', 'school education'],
    ['🏛️', 'classical building', 'government city hall'],
    ['⛺', 'tent', 'shelter camp camping'],
    ['🚗', 'automobile', 'car traffic drive'],
    ['🚌', 'bus', 'transit transport'],
    ['🚆', 'train', 'rail transit'],
    ['✈️', 'airplane', 'flight airport plane'],
    ['🚢', 'ship', 'boat ferry'],
    ['🛣️', 'motorway', 'highway road freeway'],
    ['🌉', 'bridge at night', 'bridge'],
    ['📍', 'round pushpin', 'location pin map place'],
    ['🗺️', 'world map', 'map'],
    ['📱', 'mobile phone', 'phone cell smartphone'],
    ['📞', 'telephone receiver', 'call phone'],
    ['💻', 'laptop', 'computer'],
    ['📷', 'camera', 'photo picture'],
    ['📺', 'television', 'tv news'],
    ['📰', 'newspaper', 'news paper press'],
    ['📝', 'memo', 'note write'],
    ['📅', 'calendar', 'date schedule'],
    ['⏰', 'alarm clock', 'time clock'],
    ['⏳', 'hourglass not done', 'wait time'],
  ]),
  category('animals-food', 'Animals and food', [
    ['🐶', 'dog face', 'dog pet puppy'],
    ['🐱', 'cat face', 'cat pet kitten'],
    ['🐴', 'horse face', 'horse livestock'],
    ['🐄', 'cow', 'livestock farm'],
    ['🐔', 'chicken', 'farm poultry'],
    ['🐦', 'bird', 'bird'],
    ['🐟', 'fish', 'fish'],
    ['🐝', 'honeybee', 'bee'],
    ['☕', 'hot beverage', 'coffee tea'],
    ['🍕', 'pizza', 'food'],
    ['🍔', 'hamburger', 'food burger'],
    ['🍎', 'red apple', 'food fruit'],
    ['🥤', 'cup with straw', 'drink soda'],
    ['🍞', 'bread', 'food'],
    ['🥫', 'canned food', 'supplies food'],
    ['🍼', 'baby bottle', 'baby formula'],
  ]),
]

/** Every emoji in browse order (category by category). */
export const ALL_EMOJI: readonly EmojiEntry[] = EMOJI_CATEGORIES.flatMap(c => c.emoji)
