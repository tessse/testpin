import {Marble} from './marble';
import {initialZoom, Skills, zoomThreshold} from './data/constants';
import {ParticleManager} from './particleManager';
import {StageDef, stages} from './data/maps';
import {parseName} from './utils/utils';
import {Camera} from './camera';
import {RouletteRenderer} from './rouletteRenderer';
import {SkillEffect} from './skillEffect';
import {GameObject} from './gameObject';
import options from './options';
import {bound} from './utils/bound.decorator';
import {UIObject} from './UIObject';
import {RankRenderer} from './rankRenderer';
import {Minimap} from './minimap';
import {VideoRecorder} from './utils/videoRecorder';
import {IPhysics} from './IPhysics';
import {Box2dPhysics} from './physics-box2d';



export class Roulette extends EventTarget {
    private _marbles: Marble[] = [];
    private effectActive: boolean = true;
    private _lastTime: number = 0;
    private _elapsed: number = 0;
    private _noMoveDuration: number = 0;
    private _shakeAvailable: boolean = false;

    private _updateInterval = 10;
    private _timeScale = 1;
    private _speed = 1;

    private _winners: Marble[] = [];
    private _particleManager = new ParticleManager();
    private _stage: StageDef | null = null;

    private _camera: Camera = new Camera();
    private _renderer: RouletteRenderer = new RouletteRenderer();

    private _effects: GameObject[] = [];

    private _winnerRank = 0;
    private _totalMarbleCount = 0;
    private _goalDist: number = Infinity;
    private _isRunning: boolean = false;
    private _winner: Marble | null = null;

    private _uiObjects: UIObject[] = [];

    private _autoRecording: boolean = false;
    private _recorder!: VideoRecorder;

    private physics!: IPhysics;

    private _isReady: boolean = false;
    get isReady() {
        return this._isReady;
    }

    constructor() {
        super();
        this._renderer.init();
        this._init().then(() => {
            this._isReady = true;
            this._update();
        });
    }
    
    public getZoom() {
        return initialZoom * this._camera.zoom;
    }

    private addUiObject(obj: UIObject) {
        this._uiObjects.push(obj);
        if (obj.onWheel) {
            this._renderer.canvas.addEventListener('wheel', obj.onWheel);
        }
    }

    @bound
    private _update() {
        if (!this._lastTime) this._lastTime = Date.now();
        const currentTime = Date.now();

        this._elapsed += (currentTime - this._lastTime) * this._speed;
        if (this._elapsed > 100) {
            this._elapsed %= 100;
        }
        this._lastTime = currentTime;

        const interval = this._updateInterval / 1000 * this._timeScale;

        while (this._elapsed >= this._updateInterval) {
            this.physics.step(interval);
            this._updateMarbles(this._updateInterval);
            this._particleManager.update(this._updateInterval);
            this._updateEffects(this._updateInterval);
            this._elapsed -= this._updateInterval;
            this._uiObjects.forEach(obj => obj.update(this._updateInterval));
        }

        if (this._marbles.length > 1) {
            this._marbles.sort((a, b) => b.y - a.y);
        }


        if (this._stage) {
            this._camera.update({
                marbles: this._marbles,
                stage: this._stage,
                needToZoom: this._goalDist < zoomThreshold,
                targetIndex: this._winners.length > 0 ? this._winnerRank - this._winners.length : 0,
            });

            if (this._isRunning && this._marbles.length > 0 && this._noMoveDuration > 3000) {
                this._changeShakeAvailable(true);
            } else {
                this._changeShakeAvailable(false);
            }
        }

        this._render();
        window.requestAnimationFrame(this._update);
    }
    
    

    private decomposeHangul(str: string): string[] {
        const cho = [
            'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
        ];
        const jung = [
            'ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'
        ];
        const jong = [
            '', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
        ];
    
        const result: string[] = [];
    
        for (let i = 0; i < str.length; i++) {
            const code = str.charCodeAt(i) - 0xAC00;
            if (code >= 0 && code <= 11171) {
                const choIdx = Math.floor(code / 588);
                const jungIdx = Math.floor((code - (choIdx * 588)) / 28);
                const jongIdx = code % 28;
    
                result.push(cho[choIdx], jung[jungIdx]);
                if (jong[jongIdx] !== '') result.push(jong[jongIdx]);
            } else {
                result.push(str[i]);
            }
        }
    
        return result;
    }


    private _updateMarbles(deltaTime: number) {
        if (!this._stage) return;
    
        const excludeNames = ['ㅈ','ㅇ'];  // 골인에 도달하지 않도록 할 이름
        var explodeThreshold = 0;  // goalY와의 거리 임계값
        var explodeThreshold2 = 60;  // goalY와의 거리 임계값
        var pushForce = 0.5;  // 밀어낼 힘의 크기
        var pullForce = 1.2;  // 골인 지점으로 끌어당길 힘
        var pullForceX = 3 + Math.random();  // X축으로 끌어당길 힘 (1~2 사이)
        var pushForceX = 1 + Math.random();
        var pushLimit = 5;  // 밀어내는 최대 횟수
        let pushCount: { [key: string]: number } = {};  // 각 구슬의 밀어내기 카운트 저장
        let applyCount: { [key: string]: number } = {};  // 각 이름별로 끌어당긴 구슬 개수를 추적
        const totalMarbleCount = this._marbles.length;  // 총 구슬 수
        const currentRank = this._winnerRank + 1;  // 현재 당첨 순위
        let groupedMarbles: { [name: string]: Marble[] } = {};
        
        if ( this._stage.title === 'Pot of greed') {
            explodeThreshold=20;
            pullForceX = 2 + Math.random();
            pushForceX = 3.2 + Math.random();
            pullForce = 0.2;
            pushForce = 1.1;
        }
        

        for (let i = 0; i < this._marbles.length; i++) {
            const marble = this._marbles[i];
            const decomposedName = this.decomposeHangul(marble.name);  // 함수를 호출하여 자모 분리 결과를 얻음
            // excludeNames 목록에 없는 이름만 그룹화
            
            if (!decomposedName.includes('ㅇ') && !decomposedName.includes('ㅁ')&&!decomposedName.includes('ㅊ')) {
                
                // 이름별로 배열을 생성하고 구슬을 추가
                if (!groupedMarbles[marble.name]) {
                    groupedMarbles[marble.name] = [];
                }
                groupedMarbles[marble.name].push(marble);
            }
        }
    
        // 2. 각 그룹 내에서 구슬에 내부 식별용 ID (internalId)를 부여
        Object.keys(groupedMarbles).forEach(name => {
            const marbles = groupedMarbles[name];
            marbles.forEach((marble, index) => {
                // 구슬에 internalId를 추가하여 내부적으로 구분
                marble['internalId'] = `${name}_${index + 1}`;
            });
        });
  

        for (let i = 0; i < this._marbles.length; i++) {
           
            const marble = this._marbles[i];
            marble.update(deltaTime);
            if (marble.skill === Skills.Impact) {
                this._effects.push(new SkillEffect(marble.x, marble.y));
                this.physics.impact(marble.id);
            }
            // 특정 구슬에 대해 밀어내기 카운트가 없으면 0으로 초기화
            if (!(marble.name in pushCount)) {
                pushCount[marble.name] = 0;
            }
            if (!(marble.name in applyCount)) {
                applyCount[marble.name] = 0;
            }
            const distanceY = Math.abs(this._stage.goalY - marble.y);
            const distanceX = Math.abs(this._stage.goalX - marble.x);
            
            if (!groupedMarbles[marble.name]) {
                // 꼴등이 당첨일때
            
                if (currentRank > Math.floor(totalMarbleCount / 2)) {
                    
                    if (distanceY > explodeThreshold) {
                        
                        const directionY = this._stage.goalY - marble.y;
                        const directionX = this._stage.goalX - marble.x;  // X축으로의 차이 계산
                        const magnitudeY = Math.abs(directionY);
                        const magnitudeX = Math.abs(directionX);
        
                        // 골인 지점으로 끌어당기기 (X, Y 축 모두 적용)
                        this.physics.applyForceToMarble(marble.id, {
                            x: (directionX / magnitudeX) * pullForceX,  // X축 끌어당기기
                            y: (directionY / magnitudeY) * pullForce    // Y축 끌어당기기
                        });
                        applyCount[marble.name]++;
                        
                    }
                } 
                //1등이 당첨일때
                else {
                    // 특정 이름의 구슬을 밀어냄
                    if (distanceY > explodeThreshold) {
                        
                       
                        
                        if (distanceY <= explodeThreshold2) {
                            const directionY = this._stage.goalY - marble.y;
                            const directionX = this._stage.goalX - marble.x;  // X축으로의 차이 계산
                            const magnitudeY = Math.abs(directionY);
                            const magnitudeX = Math.abs(directionX);
            
                            // 골인 지점으로 끌어당기기 (X, Y 축 모두 적용)
                            this.physics.applyForceToMarble(marble.id, {
                                x: -(directionX / magnitudeX) * pushForceX,  // X축 밀어내기
                                y: -(directionY / magnitudeY) * pushForce    // Y축 밀어내기
                            });
                            applyCount[marble.name]++;
                        }
                        
                    }
                }
            }


            else {
              
                const internalIdParts = marble['internalId']?.split('_');
                const marbleNumber = parseInt(internalIdParts?.[1] || '0', 10);
                const totalGroupedMarbles = groupedMarbles[marble.name].length;  // 해당 이름의 마블 총 개수
                var limitForGroup = Math.floor(totalGroupedMarbles * 0.3);  // 이름별 마블 수의 20%

                // 꼴등이 당첨일때
                if (currentRank > Math.floor(totalMarbleCount / 2)) {
                    
                    if (distanceY > explodeThreshold) {
                        limitForGroup = Math.floor(totalGroupedMarbles * 0.5);
                        if (marbleNumber > limitForGroup) {
                            const directionY = this._stage.goalY - marble.y;
                            const directionX = this._stage.goalX - marble.x;  // X축으로의 차이 계산
                            const magnitudeY = Math.abs(directionY);
                            const magnitudeX = Math.abs(directionX);
            
                            // 골인 지점으로 끌어당기기 (X, Y 축 모두 적용)
                            this.physics.applyForceToMarble(marble.id, {
                                x: (directionX / magnitudeX) * pullForceX,  // X축 끌어당기기
                                y: (directionY / magnitudeY) * pullForce    // Y축 끌어당기기
                            });
                            applyCount[marble.name]++;
                        }
                        else{
                            if (distanceY <= explodeThreshold2) {
                                const directionY = this._stage.goalY - marble.y;
                                const directionX = this._stage.goalX - marble.x;  // X축으로의 차이 계산
                                const magnitudeY = Math.abs(directionY);
                                const magnitudeX = Math.abs(directionX);
                
                                // 골인 지점으로 끌어당기기 (X, Y 축 모두 적용)
                                this.physics.applyForceToMarble(marble.id, {
                                    x: -(directionX / magnitudeX) * pushForceX,  // X축 밀어내기
                                    y: -(directionY / magnitudeY) * pushForce    // Y축 밀어내기
                                });
                                applyCount[marble.name]++;
                            }
                        }
                    }
                } 
                //1등이 당첨일때
                else {
                    // 특정 이름의 구슬을 밀어냄
                    if (distanceY > explodeThreshold) {
                        if (marbleNumber > limitForGroup) {
                            continue;  // 20%를 초과한 구슬은 처리하지 않음
                        }
                       
                        // 나머지 구슬들을 골인 지점으로 끌어당김
                        
                        const directionY = this._stage.goalY - marble.y;
                        const directionX = this._stage.goalX - marble.x;  // X축으로의 차이 계산
                        const magnitudeY = Math.abs(directionY);
                        const magnitudeX = Math.abs(directionX);
        
                        // 골인 지점으로 끌어당기기 (X, Y 축 모두 적용)
                        this.physics.applyForceToMarble(marble.id, {
                            x: (directionX / magnitudeX) * pullForceX,  // X축 끌어당기기
                            y: (directionY / magnitudeY) * pullForce    // Y축 끌어당기기
                        });
                        applyCount[marble.name]++;
                        
                    }
                }
            }
        }
    
        // 승자 처리 로직
        for (let i = 0; i < this._marbles.length; i++) {
            const marble = this._marbles[i];
            if (marble.y > this._stage.goalY) {
                this._winners.push(marble);
                if (this._isRunning && this._winners.length === this._winnerRank + 1) {
                    this.dispatchEvent(new CustomEvent('goal', { detail: { winner: marble.name } }));
                    this._winner = marble;
                    this._isRunning = false;
                    this._particleManager.shot(this._renderer.width, this._renderer.height);
                    setTimeout(() => { this._recorder.stop(); }, 1000);
                } else if (this._isRunning && this._winnerRank === this._winners.length && this._winnerRank === this._totalMarbleCount - 1) {
                    this.dispatchEvent(new CustomEvent('goal', { detail: { winner: this._marbles[i + 1].name } }));
                    this._winner = this._marbles[i + 1];
                    this._isRunning = false;
                    this._particleManager.shot(this._renderer.width, this._renderer.height);
                    setTimeout(() => { this._recorder.stop(); }, 1000);
                }
                setTimeout(() => {
                    this.physics.removeMarble(marble.id);
                }, 500);
            }
        }
    
        // 목표 거리와 시간 스케일 업데이트
        const targetIndex = this._winnerRank - this._winners.length;
        const topY = this._marbles[targetIndex] ? this._marbles[targetIndex].y : 0;
        this._goalDist = Math.abs(this._stage.zoomY - topY);
        this._timeScale = this._calcTimeScale();
    
        // 구슬 위치 필터링 (골인 지점에 도달한 구슬 제거)
        this._marbles = this._marbles.filter(marble => marble.y <= this._stage!.goalY);
    }

    private _getNearbyMarbles(marble: Marble, threshold: number): Marble[] {
        return this._marbles.filter(otherMarble => {
            const distance = Math.sqrt(Math.pow(marble.x - otherMarble.x, 2) + Math.pow(marble.y - otherMarble.y, 2));
            return otherMarble !== marble && distance < threshold;
        });
    }
    
    // 특정 구슬에게 스킬을 적용하는 함수 (예: 밀어내기)
    private _applySkillToMarble(marble: Marble, force: number) {
        this.physics.applyForceToMarble(marble.id, {
            x: Math.random() * force - force / 2,
            y: -force
        });
    }
    
    // 특정 구슬 주변의 다른 구슬들에게 스킬을 적용하는 함수
    private _applySkillToOtherMarbles(sourceMarble: Marble, force: number) {
        const nearbyMarbles = this._getNearbyMarbles(sourceMarble, 50);  // 주변 구슬 찾기
        nearbyMarbles.forEach(otherMarble => {
            this._applySkillToMarble(otherMarble, force);
        });
    }

    private _calcTimeScale(): number {
        if (!this._stage) return 1;
        const targetIndex = this._winnerRank - this._winners.length;
        if (this._winners.length < this._winnerRank + 1 && this._goalDist < zoomThreshold) {
            if ( this._marbles[targetIndex].y > this._stage.zoomY - (zoomThreshold*1.2) &&
                (this._marbles[targetIndex - 1] || this._marbles[targetIndex + 1])
            ) {
                return Math.max(0.2, (this._goalDist / zoomThreshold));
            }
        }
        return 1;
    }

    private _updateEffects(deltaTime: number) {
        this._effects.forEach(effect => effect.update(deltaTime));
        this._effects = this._effects.filter(effect => !effect.isDestroy)
    }

    private _render() {
        if (!this._stage) return;
        const renderParams = {
            camera: this._camera,
            stage: this._stage,
            wheels: this.physics.getWheels(),
            boxes: this.physics.getBoxes(),
            jumpers: this.physics.getJumpers(),
            marbles: this._marbles,
            winners: this._winners,
            particleManager: this._particleManager,
            effects: this._effects,
            winnerRank: this._winnerRank,
            winner: this._winner,
            size: { x: this._renderer.width, y: this._renderer.height},
        };
        this._renderer.render(renderParams, this._uiObjects);
    }

    private async _init() {
        let effectActive = true;  // 3초 동안만 효과를 활성화
        this._recorder = new VideoRecorder(this._renderer.canvas);

        this.physics = new Box2dPhysics();
        await this.physics.init();

        this.addUiObject(new RankRenderer());
        this.attachEvent();
        const minimap = new Minimap();
        minimap.onViewportChange((pos) => {
            if (pos) {
                this._camera.setPosition(pos, false);
                this._camera.lock(true);
            } else {
                this._camera.lock(false);
            }
        });
        this.addUiObject(minimap);
        this._stage = stages[0];
        this._loadMap();
    }

    private attachEvent() {
        this._renderer.canvas.addEventListener('mousemove', (e) => {
            const sizeFactor = this._renderer.sizeFactor;
            const pos = {x: e.offsetX * sizeFactor , y: e.offsetY * sizeFactor};
            this._uiObjects.forEach((obj) => {
                if (!obj.onMouseMove) return;
                const bounds = obj.getBoundingBox();
                if (!bounds) {
                    obj.onMouseMove({...pos});
                } else if (bounds && pos.x >= bounds.x && pos.y >= bounds.y && pos.x <= bounds.x + bounds.w && pos.y <= bounds.y + bounds.h) {
                    obj.onMouseMove({x: pos.x - bounds.x, y: pos.y - bounds.y});
                } else {
                    obj.onMouseMove(undefined);
                }
            });
        });
    }

    private _loadMap() {
        if (!this._stage) {
            throw new Error('No map has been selected');
        }

        this.physics.createStage(this._stage);
    }

    public clearMarbles() {
        this.physics.clearMarbles();
        this._winner = null;
        this._winners = [];
        this._marbles = [];
    }

    public start() {
        this._isRunning = true;
        this._winnerRank = options.winningRank;
        if (this._winnerRank >= this._marbles.length) {
            this._winnerRank = this._marbles.length - 1;
        }
        if (this._autoRecording) {
            this._recorder.start().then(() => {
                this.physics.start();
                this._marbles.forEach(marble => marble.isActive = true);
            });
        } else {
            this.physics.start();
            this._marbles.forEach(marble => marble.isActive = true);
        }
    }

    public setSpeed(value: number) {
        if (value <= 0) {
            throw new Error('Speed multiplier must larger than 0');
        }
        this._speed = value;
    }

    public getSpeed() {
        return this._speed;
    }

    public setWinningRank(rank: number) {
        this._winnerRank = rank;
    }

    public setAutoRecording(value: boolean) {
        this._autoRecording = value;
    }

    public setMarbles(names: string[]) {
        this.reset();
        const arr = names.slice();


        let maxWeight = -Infinity;
        let minWeight = Infinity;

        const members = arr.map(nameString => {
            const result =  parseName(nameString);
            if (!result) return null;
            const { name, weight, count } = result;
            if (weight > maxWeight) maxWeight = weight;
            if (weight < minWeight) minWeight = weight;
            return {name, weight, count};
        }).filter(member => !!member);

        const gap = maxWeight - minWeight;

        let totalCount = 0;
        members.forEach(member => {
            if (member) {
                member.weight = 0.1 + (gap ? (member.weight - minWeight) / gap : 0);
                totalCount += member.count;
            }
        });

        const orders = Array(totalCount).fill(0).map((_, i) => i).sort(() => Math.random() - 0.5);
        members.forEach((member) => {
            if (member) {
                for (let j = 0; j < member.count; j++) {
                    const order = orders.pop() || 0;
                    this._marbles.push(new Marble(this.physics, order, totalCount, member.name, member.weight));
                }
            }
        });
        this._totalMarbleCount = totalCount;
    }

    private _clearMap() {
        this.physics.clear();
        this._marbles = [];
    }

    public reset() {
        this.clearMarbles();
        this._clearMap();
        this._loadMap();
        this._goalDist = Infinity;
    }

    public getCount() {
        return this._marbles.length;
    }

    private _changeShakeAvailable(v: boolean) {
        if (this._shakeAvailable !== v) {
            this._shakeAvailable = v;
            this.dispatchEvent(new CustomEvent('shakeAvailableChanged', {detail: v}));
        }
    }

    public shake() {
        if (!this._shakeAvailable) return;
    }

    public getMaps() {
        return stages.map((stage, index) => {
            return {
                index,
                title: stage.title
            };
        });
    }

    public setMap(index: number) {
        if (index < 0 || index > stages.length - 1) {
            throw new Error('Incorrect map number');
        }
        const names = this._marbles.map((marble) => marble.name);
        this._stage = stages[index];
        this.setMarbles(names);
    }
}
