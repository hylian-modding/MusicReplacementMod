import { IPlugin, IModLoaderAPI } from 'modloader64_api/IModLoaderAPI';
import { InjectCore } from 'modloader64_api/CoreInjection';
import path from 'path';
import fs from 'fs-extra';
import { SequencePlayer } from './SequencePlayer';
import { IOOTCore } from 'modloader64_api/OOT/OOTAPI';
import { EventHandler } from 'modloader64_api/EventHandler';
import { MusicReplacementEvents, MusicReplacementTrack } from './MusicReplacementAPI';

class OoT_MusicReplacementMod implements IPlugin {

    ModLoader!: IModLoaderAPI;
    @InjectCore()
    core!: IOOTCore;
    is_out_of_title!: number;
    sequencePlayers!: SequencePlayer[];
    cache: Map<string, Buffer> = new Map<string, Buffer>();

    preinit(): void {
        if (!fs.existsSync("./music")) {
            fs.mkdirSync("./music");
        }
    }

    @EventHandler(MusicReplacementEvents.LOAD_TRACK)
    onTrack(track: MusicReplacementTrack) {
        this.ModLoader.logger.info("Caching music track from API: " + track.name + ".");
        this.cache.set(track.name, track.content);
    }

    init(): void {
        let music_folder: string = path.resolve(global.ModLoader.startdir, "music");
        this.searchRecursive(music_folder).forEach((file: string) => {
            this.ModLoader.logger.info("Caching music track from folder: " + file + ".");
            let buf: Buffer = fs.readFileSync(file);
            let name: string = path.parse(file).name;
            this.cache.set(name, buf);
        });
    }

    postinit(): void {
        // Create emulated sequence players
        this.sequencePlayers = new Array<SequencePlayer>(3);
        this.sequencePlayers.push(new SequencePlayer(this.ModLoader.emulator, 0x80128B60));
        this.sequencePlayers.push(new SequencePlayer(this.ModLoader.emulator, 0x80128CC0));
        //this.sequencePlayers.push(new SequencePlayer(this.ModLoader.emulator, 0x80128E20));
        this.sequencePlayers.push(new SequencePlayer(this.ModLoader.emulator, 0x80128F80));

        //Mute OG Music
        this.ModLoader.utils.setIntervalFrames(() => {
            for (let i = 0x3; i < 0x26; i++) {
                this.ModLoader.emulator.rdramWrite32(0x80113750 + (i * 0x10), 0xFFFFFFFF);
            }
        }, 10);
    }

    searchRecursive(dir: string): Array<string> {
        // This is where we store pattern matches of all files inside the directory
        let results = new Array<string>();

        // Read contents of directory
        fs.readdirSync(dir).forEach((dirInner) => {
            // Obtain absolute path
            dirInner = path.resolve(dir, dirInner);

            // Get stats to determine if path is a directory or a file
            var stat = fs.statSync(dirInner);

            // If path is a directory, scan it and combine results
            if (stat.isDirectory()) {
                results = results.concat(this.searchRecursive(dirInner));
            }

            // If path is a file and ends with pattern then push it onto results
            if (stat.isFile()) {
                results.push(dirInner);
            }
        });

        return results;
    }

    onTick(frame?: number | undefined): void {
        this.sequencePlayers.forEach(player => {
            // Only change volume if the OG song is actually playing
            if (player.music !== undefined && player.last_music_playing && player.last_music_id === player.music_id) {
                // Set volume to the same as in-game
                if ((player.volume_og * 100) <= 100) {
                    player.music.volume = (player.volume_og * 100);
                }

                // Decrease volume if paused
                if (player.is_paused) {
                    player.music.volume /= 3;
                }

                // Mute music if OG is muted too
                /*if (player.is_muted) {
                    player.music.volume = 0;
                }*/
            }

            // Play new music
            if ((!player.last_music_playing || player.last_music_id !== player.music_id) && player.is_og_playing) {
                if (player.music !== undefined) {
                    player.music.stop();
                    player.music.release();
                }

                this.cache.forEach((buf: Buffer, file: string) => {
                    let fileSplits: string[] = path.parse(file).name.split('-');
                    let id: number = parseInt(fileSplits[0].trim(), 16);

                    // Check for file arguments in the file name
                    if (id === player.music_id) {
                        player.music = this.ModLoader.sound.initMusic(buf);

                        if (fileSplits.length > 1) {
                            if (fileSplits[1].trim() === "loop") {
                                player.music.loop = true;

                                if (fileSplits.length >= 4) {
                                    player.loop_start = parseFloat(fileSplits[2].trim());
                                    player.loop_end = parseFloat(fileSplits[3].trim());
                                    player.SetLoopTimes(player.loop_start, player.loop_end);
                                }
                            }
                        }

                        let vol = (global.ModLoader["GLOBAL_VOLUME"] as number) >= player.volume_og ? player.volume_og : global.ModLoader["GLOBAL_VOLUME"] as number;
                        player.music.volume = vol;
                        player.music.play();

                        player.last_music_id = player.music_id;
                        player.last_music_playing = player.is_og_playing;

                        return;
                    }
                });
            }

            player.last_music_id = player.music_id;
            player.last_music_playing = player.is_og_playing;
        });
    }
}

module.exports = OoT_MusicReplacementMod;